/**
 * RaceRoom — one Durable Object instance owns the state of one multiplayer
 * racing room (player roster + persisted best-lap leaderboard).
 *
 * Protocol parity with the legacy Node server is intentional: the client
 * (`src/network/MultiplayerClient.ts`) speaks the same messages, so only
 * the transport endpoint changed (`/ws/:roomId`).
 *
 * Client -> server: `update`, `livery`, `lap_completed`
 * Server -> client: `init`, `player_joined`, `player_left`, `player_update`,
 *                   `player_livery`, `leaderboard_update`
 *
 * Uses the hibernatable WebSocket API (`acceptWebSocket` +
 * `webSocketMessage`/`webSocketClose`) so idle connections don't burn CPU.
 */
import {
  LAP_MIN_INTERVAL_MS,
  LEADERBOARD_MAX_ENTRIES,
  LIVERIES,
  MAX_MESSAGE_CHARS,
  UPDATE_MIN_INTERVAL_MS,
  insertLeaderboard,
  isValidLivery,
  makePlayerId,
  makePlayerName,
  sanitizeFlag,
  sanitizeLapTime,
  sanitizeLivery,
  sanitizeUpdate,
  type LeaderboardEntry,
  type LiveryConfig,
  type PlayerSnapshot,
} from './protocol';

interface PlayerState extends PlayerSnapshot {
  lastUpdateAt: number;
  lastLapAt: number;
}

interface Attachment {
  playerId: string;
}

const LEADERBOARD_KEY = 'leaderboard:v1';

export class RaceRoom implements DurableObject {
  private ctx: DurableObjectState;
  private players: Map<string, PlayerState> = new Map(); // playerId -> state
  private leaderboard: LeaderboardEntry[] = [];
  private leaderboardLoaded = false;
  private nextPlayerIndex = 0;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
  }

  // -- HTTP entry: only WebSocket upgrades are accepted ----------------------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }
    await this.ensureLeaderboard();

    const playerId = makePlayerId();
    const livery: LiveryConfig = { ...LIVERIES[this.nextPlayerIndex % LIVERIES.length] };
    this.nextPlayerIndex += 1;
    const name = makePlayerName(playerId);

    const player: PlayerState = {
      id: playerId,
      name,
      livery,
      flag: '🏁',
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      speed: 0,
      lap: 1,
      bestLapTime: null,
      lastUpdateAt: 0,
      lastLapAt: 0,
    };
    this.players.set(playerId, player);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(JSON.stringify({ playerId } satisfies Attachment));

    // Private init for the newcomer (roster excludes self, like legacy).
    const others: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      if (p.id !== playerId) others.push(publicSnapshot(p));
    }
    server.send(
      JSON.stringify({
        type: 'init',
        playerId,
        name,
        livery,
        players: others,
        leaderboard: this.leaderboard,
      }),
    );

    // Tell everyone else.
    this.broadcast({ type: 'player_joined', player: publicSnapshot(player) }, playerId);
    return new Response(null, { status: 101, webSocket: client });
  }

  // -- Hibernatable WebSocket events ------------------------------------------
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return; // binary frames are not part of the protocol
    if (message.length > MAX_MESSAGE_CHARS) return; // oversized payload: drop it
    const player = this.playerForSocket(ws);
    if (!player) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return; // malformed JSON: ignore, keep the connection alive
    }
    if (!msg || typeof msg !== 'object') return;

    try {
      switch (msg['type']) {
        case 'update': {
          const now = Date.now();
          if (now - player.lastUpdateAt < UPDATE_MIN_INTERVAL_MS) return; // 40 Hz throttle
          const clean = sanitizeUpdate(msg);
          if (!clean) return;
          player.lastUpdateAt = now;
          player.position = clean.position;
          player.quaternion = clean.quaternion;
          player.speed = clean.speed;
          player.lap = clean.lap;
          this.broadcast(
            {
              type: 'player_update',
              id: player.id,
              position: player.position,
              quaternion: player.quaternion,
              speed: player.speed,
              lap: player.lap,
            },
            player.id,
          );
          break;
        }
        case 'livery': {
          if (!isValidLivery(msg['livery'])) return;
          const next = sanitizeLivery(msg['livery']);
          const l = player.livery;
          let changed = false;
          if (
            l.bodyColor !== next.bodyColor ||
            l.accentColor !== next.accentColor ||
            l.sideColor !== next.sideColor ||
            l.helmetColor !== next.helmetColor
          ) {
            player.livery = next;
            changed = true;
          }
          if (typeof msg['flag'] === 'string') {
            const flag = sanitizeFlag(msg['flag']);
            if (flag !== player.flag) {
              player.flag = flag;
              changed = true;
            }
          }
          if (changed) {
            this.broadcast({
              type: 'player_livery',
              id: player.id,
              livery: player.livery,
              flag: player.flag,
            });
          }
          break;
        }
        case 'lap_completed': {
          const now = Date.now();
          if (now - player.lastLapAt < LAP_MIN_INTERVAL_MS) return; // lap spam guard
          const lapTime = sanitizeLapTime(msg['lapTime']);
          if (lapTime === null) return; // impossible / broken lap time
          player.lastLapAt = now;
          if (player.bestLapTime === null || lapTime < player.bestLapTime) {
            player.bestLapTime = lapTime;
          }
          await this.ensureLeaderboard();
          this.leaderboard = insertLeaderboard(this.leaderboard, {
            id: player.id,
            name: player.name,
            lapTime,
          });
          await this.ctx.storage.put(LEADERBOARD_KEY, this.leaderboard);
          this.broadcastAll({ type: 'leaderboard_update', leaderboard: this.leaderboard });
          break;
        }
        default:
          break; // unknown message types are ignored
      }
    } catch (err) {
      console.error('[RaceRoom] Error handling message:', err);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.removeSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.removeSocket(ws);
  }

  // -- Internals ---------------------------------------------------------------
  private playerForSocket(ws: WebSocket): PlayerState | null {
    try {
      const raw = ws.deserializeAttachment() as string | null;
      if (!raw) return null;
      const { playerId } = JSON.parse(raw) as Attachment;
      // The in-memory map can be cold after hibernation eviction; the
      // attachment is the source of truth for "which player is this socket".
      return this.players.get(playerId) ?? null;
    } catch {
      return null;
    }
  }

  private removeSocket(ws: WebSocket): void {
    let playerId: string | null = null;
    try {
      const raw = ws.deserializeAttachment() as string | null;
      if (raw) playerId = (JSON.parse(raw) as Attachment).playerId;
    } catch {
      playerId = null;
    }
    if (!playerId) return;
    if (this.players.delete(playerId)) {
      this.broadcastAll({ type: 'player_left', id: playerId });
    }
  }

  private broadcast(msg: unknown, exceptPlayerId?: string): void {
    const payload = JSON.stringify(msg);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      if (exceptPlayerId !== undefined && this.socketPlayerId(ws) === exceptPlayerId) continue;
      try {
        ws.send(payload);
      } catch {
        // Dead socket: close handler will reap it.
      }
    }
  }

  private broadcastAll(msg: unknown): void {
    this.broadcast(msg);
  }

  private socketPlayerId(ws: WebSocket): string | null {
    try {
      const raw = ws.deserializeAttachment() as string | null;
      if (!raw) return null;
      return (JSON.parse(raw) as Attachment).playerId;
    } catch {
      return null;
    }
  }

  private async ensureLeaderboard(): Promise<void> {
    if (this.leaderboardLoaded) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<LeaderboardEntry[]>(LEADERBOARD_KEY);
      if (Array.isArray(stored)) {
        // Re-validate stored rows; storage is trusted but cheap to check.
        this.leaderboard = stored
          .filter(
            (e) =>
              e &&
              typeof e.id === 'string' &&
              typeof e.name === 'string' &&
              typeof e.lapTime === 'number' &&
              Number.isFinite(e.lapTime),
          )
          .slice(0, LEADERBOARD_MAX_ENTRIES);
      }
      this.leaderboardLoaded = true;
    });
  }
}

function publicSnapshot(p: PlayerState): PlayerSnapshot {
  return {
    id: p.id,
    name: p.name,
    livery: { ...p.livery },
    flag: p.flag,
    position: { ...p.position },
    quaternion: { ...p.quaternion },
    speed: p.speed,
    lap: p.lap,
    bestLapTime: p.bestLapTime,
  };
}
