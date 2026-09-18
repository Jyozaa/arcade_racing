import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number.parseInt(process.env.PORT || '8080', 10) || 8080;
const UPDATE_MIN_INTERVAL_MS = 25; // drop movement packets faster than 40 Hz
const LAP_MIN_INTERVAL_MS = 10000; // min gap between accepted laps per player
const LEADERBOARD_MAX_ENTRIES = 100;
const HEARTBEAT_INTERVAL_MS = 30000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const HAVE_DIST = fs.existsSync(path.join(DIST, 'index.html'));

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const players = new Map(); // ws -> player state
const leaderboards = []; // { id, name, lapTime }

const LIVERIES = [
  { bodyColor: 0xef4444, accentColor: 0xffffff, sideColor: 0x2563eb, helmetColor: 0xfacc15 }, // Player / Red-Blue-White
  { bodyColor: 0xeab308, accentColor: 0x18181b, sideColor: 0xf97316, helmetColor: 0xffffff }, // Yellow-Orange
  { bodyColor: 0x06b6d4, accentColor: 0xffffff, sideColor: 0x0284c7, helmetColor: 0xf43f5e }, // Cyan-White
  { bodyColor: 0x10b981, accentColor: 0xfacc15, sideColor: 0x047857, helmetColor: 0xffffff }, // Green-Yellow
  { bodyColor: 0x8b5cf6, accentColor: 0xffffff, sideColor: 0x6d28d9, helmetColor: 0x06b6d4 }, // Purple-White
  { bodyColor: 0xf97316, accentColor: 0x1e3a8a, sideColor: 0xffffff, helmetColor: 0xfacc15 }, // Gulf Orange-Navy
  { bodyColor: 0xec4899, accentColor: 0x18181b, sideColor: 0xffffff, helmetColor: 0xeab308 }, // Pink-Black
  { bodyColor: 0x3b82f6, accentColor: 0xffffff, sideColor: 0x1d4ed8, helmetColor: 0xfacc15 }  // Royal Blue-White
];

const isValidLivery = (l) => !!l && ['bodyColor', 'accentColor', 'sideColor', 'helmetColor']
  .every((k) => Number.isFinite(l[k]));

let nextPlayerIndex = 0;

function serveStatic(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost');

    // Health check.
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, players: players.size }));
      return;
    }

    if (!HAVE_DIST) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found (build the client with: npm run build)');
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'public, max-age=3600',
      });
      res.end(data);
    });
  } catch {
    try { res.writeHead(500); res.end(); } catch { /* already closed */ }
  }
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

// Drop dead peers so abandoned connections can't accumulate.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch { /* already gone */ }
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* will be reaped next round */ }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const playerId = `player_${Math.random().toString(36).substring(2, 8)}`;
  const liveryIndex = nextPlayerIndex % LIVERIES.length;
  nextPlayerIndex++;
  const livery = LIVERIES[liveryIndex];
  const playerName = `Racer_${playerId.substring(7)}`;

  const newPlayer = {
    id: playerId,
    name: playerName,
    livery,
    flag: '🏁',
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0,
    lap: 1,
    bestLapTime: null,
    lastUpdateAt: 0,
    lastLapAt: 0
  };

  players.set(ws, newPlayer);

  ws.send(JSON.stringify({
    type: 'init',
    playerId,
    name: playerName,
    livery,
    players: Array.from(players.values()).filter(p => p.id !== playerId),
    leaderboard: leaderboards
  }));

  broadcast({
    type: 'player_joined',
    player: newPlayer
  }, ws);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // ignore malformed frames
    }
    const p = players.get(ws);
    if (!p) return;

    try {
      if (msg.type === 'update') {
        // Throttle movement floods (client sends at 20 Hz).
        const now = Date.now();
        if (now - p.lastUpdateAt < UPDATE_MIN_INTERVAL_MS) return;
        p.lastUpdateAt = now;

        p.position = msg.position;
        p.quaternion = msg.quaternion;
        p.speed = msg.speed;
        p.lap = msg.lap;

        broadcast({
          type: 'player_update',
          id: p.id,
          position: p.position,
          quaternion: p.quaternion,
          speed: p.speed,
          lap: p.lap
        }, ws);
      } else if (msg.type === 'livery') {
        if (isValidLivery(msg.livery)) {
          let changed = false;
          const l = p.livery;
          if (l.bodyColor !== msg.livery.bodyColor || l.accentColor !== msg.livery.accentColor ||
              l.sideColor !== msg.livery.sideColor || l.helmetColor !== msg.livery.helmetColor) {
            p.livery = msg.livery;
            changed = true;
          }
          if (typeof msg.flag === 'string' && msg.flag.length > 0 && msg.flag.length <= 16 && msg.flag !== p.flag) {
            p.flag = msg.flag;
            changed = true;
          }
          if (changed) {
            broadcast({
              type: 'player_livery',
              id: p.id,
              livery: p.livery,
              flag: p.flag
            }, ws);
          }
        }
      } else if (msg.type === 'lap_completed') {
        // Throttle lap spam (broadcast amplification) + anti-cheat floor.
        const now = Date.now();
        if (now - p.lastLapAt < LAP_MIN_INTERVAL_MS) return;
        if (typeof msg.lapTime === 'number' && msg.lapTime > 15) {
          p.lastLapAt = now;
          if (!p.bestLapTime || msg.lapTime < p.bestLapTime) {
            p.bestLapTime = msg.lapTime;
          }

          const existingEntry = leaderboards.find(e => e.id === p.id);
          if (existingEntry) {
            if (msg.lapTime < existingEntry.lapTime) {
              existingEntry.lapTime = msg.lapTime;
            }
          } else {
            leaderboards.push({
              id: p.id,
              name: p.name,
              lapTime: msg.lapTime
            });
          }

          leaderboards.sort((a, b) => a.lapTime - b.lapTime);
          if (leaderboards.length > LEADERBOARD_MAX_ENTRIES) {
            leaderboards.length = LEADERBOARD_MAX_ENTRIES;
          }

          broadcastAll({
            type: 'leaderboard_update',
            leaderboard: leaderboards
          });
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    const p = players.get(ws);
    if (p) {
      players.delete(ws);
      broadcastAll({
        type: 'player_left',
        id: p.id
      });
    }
  });
});

function broadcast(msg, senderWs) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastAll(msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function shutdown(signal) {
  console.log(`[Multiplayer] ${signal} received, shutting down...`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server shutting down'); } catch { /* ignore */ }
  }
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  // Force exit if connections hang.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', (err) => {
  console.error('[Multiplayer] Server error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[Multiplayer] Game + WebSocket server on http://localhost:${PORT} (health: /health)`);
});
