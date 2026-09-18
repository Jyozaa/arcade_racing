/**
 * RaceRoom — one Durable Object instance owns the state of one multiplayer
 * racing room (player roster + per-track best-lap leaderboards).
 *
 * Client -> server: `update`, `livery`, `lap_completed` {lapTime, trackId},
 *                    `hello` {name}, `get_leaderboard` {trackId}
 * Server -> client: `init`, `player_joined`, `player_left`, `player_update`,
 *                   `player_livery`, `player_renamed` {id, name},
 *                   `leaderboard_update` {trackId, leaderboard}
 *
 * Uses the hibernatable WebSocket API (`acceptWebSocket` +
 * `webSocketMessage`/`webSocketClose`) so idle connections don't burn CPU.
 */
import {
  LAP_MIN_INTERVAL_MS,
  LEADERBOARD_MAX_ENTRIES,
  LIVERIES,
  MAX_BOARDS,
  MAX_MESSAGE_CHARS,
  UPDATE_MIN_INTERVAL_MS,
  insertLeaderboard,
  isValidLivery,
  makePlayerId,
  makePlayerName,
  renameLeaderboardEntries,
  sanitizeDriverName,
  sanitizeFlag,
  sanitizeLapTime,
  sanitizeLeaderboardList,
  sanitizeLivery,
  sanitizeTrackId,
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

const LEADERBOARDS_KEY = 'leaderboards:v2';

export class RaceRoom implements DurableObject {
  private ctx: DurableObjectState;
  private players: Map<string, PlayerState> = new Map(); // playerId -> state
  private boards: Map<string, LeaderboardEntry[]> = new Map(); // trackId -> best laps
  private boardsLoaded = false;
  private nextPlayerIndex = 0;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
  }

  // -- HTTP entry: only WebSocket upgrades are accepted ----------------------
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }
    await this.ensureBoards();

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
    // Boards are fetched per track via `get_leaderboard`, so init stays small.
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
          const trackId = sanitizeTrackId(msg['trackId']);
          if (trackId === null) return; // laps must name a real track board
          player.lastLapAt = now;
          if (player.bestLapTime === null || lapTime < player.bestLapTime) {
            player.bestLapTime = lapTime;
          }
          await this.ensureBoards();
          const board = this.getOrCreateBoard(trackId);
          if (!board) return; // board cap reached: ignore, don't grow memory
          this.boards.set(
            trackId,
            insertLeaderboard(board, { id: player.id, name: player.name, lapTime }),
          );
          await this.persistBoards();
          this.broadcastAll({
            type: 'leaderboard_update',
            trackId,
            leaderboard: this.boards.get(trackId),
          });
          break;
        }
        case 'get_leaderboard': {
          const trackId = sanitizeTrackId(msg['trackId']);
          if (trackId === null) return;
          await this.ensureBoards();
          this.sendTo(ws, {
            type: 'leaderboard_update',
            trackId,
            leaderboard: this.boards.get(trackId) ?? [],
          });
          break;
        }
        case 'hello': {
          // Driver name for Open Track, sent right after connect.
          const name = sanitizeDriverName(msg['name']);
          if (name === null || name === player.name) return;
          player.name = name;
          this.broadcastAll({ type: 'player_renamed', id: player.id, name });
          // Keep the player's existing board rows under the new name.
          await this.ensureBoards();
          let touched = false;
          for (const [trackId, board] of this.boards) {
            const { list, changed } = renameLeaderboardEntries(board, player.id, name);
            if (changed) {
              this.boards.set(trackId, list);
              touched = true;
              this.broadcastAll({ type: 'leaderboard_update', trackId, leaderboard: list });
            }
          }
          if (touched) await this.persistBoards();
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

  private sendTo(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Dead socket: close handler will reap it.
    }
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

  private getOrCreateBoard(trackId: string): LeaderboardEntry[] | null {
    const existing = this.boards.get(trackId);
    if (existing) return existing;
    if (this.boards.size >= MAX_BOARDS) return null;
    const fresh: LeaderboardEntry[] = [];
    this.boards.set(trackId, fresh);
    return fresh;
  }

  private async persistBoards(): Promise<void> {
    const snapshot: Record<string, LeaderboardEntry[]> = {};
    for (const [trackId, board] of this.boards) {
      snapshot[trackId] = board.slice(0, LEADERBOARD_MAX_ENTRIES);
    }
    await this.ctx.storage.put(LEADERBOARDS_KEY, snapshot);
  }

  private async ensureBoards(): Promise<void> {
    if (this.boardsLoaded) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<Record<string, unknown>>(LEADERBOARDS_KEY);
      if (stored && typeof stored === 'object') {
        for (const [trackId, rawBoard] of Object.entries(stored)) {
          if (sanitizeTrackId(trackId) === null) continue;
          if (this.boards.size >= MAX_BOARDS) break;
          const board = sanitizeLeaderboardList(rawBoard);
          if (board.length > 0) this.boards.set(trackId, board);
        }
      }
      this.boardsLoaded = true;
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
