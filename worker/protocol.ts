/**
 * Shared multiplayer protocol helpers for the Cloudflare backend.
 *
 * This module is intentionally free of Worker APIs so the pure logic
 * (validation, sanitising, leaderboard rules) can be unit-tested with
 * plain Node. `RaceRoom.ts` owns all socket/storage behaviour and
 * delegates to these helpers so client payloads are never trusted blindly.
 */

// ---- Tunables (parity with the legacy Node server) -------------------------
export const UPDATE_MIN_INTERVAL_MS = 25; // drop movement packets faster than 40 Hz
export const LAP_MIN_INTERVAL_MS = 10_000; // min gap between accepted laps per player
export const LEADERBOARD_MAX_ENTRIES = 100;
export const MAX_MESSAGE_CHARS = 64 * 1024; // same cap the old `ws` server used
export const MIN_LAP_TIME = 15; // seconds; anything faster is impossible / spam
export const MAX_LAP_TIME = 3600; // seconds; anything slower is a broken client clock
export const MAX_NAME_CHARS = 24;
export const MAX_FLAG_CHARS = 16;
export const DEFAULT_ROOM_ID = 'public';

// Default paint rotation for fresh sessions (same palette as legacy server).
export const LIVERIES = [
  { bodyColor: 0xef4444, accentColor: 0xffffff, sideColor: 0x2563eb, helmetColor: 0xfacc15 },
  { bodyColor: 0xeab308, accentColor: 0x18181b, sideColor: 0xf97316, helmetColor: 0xffffff },
  { bodyColor: 0x06b6d4, accentColor: 0xffffff, sideColor: 0x0284c7, helmetColor: 0xf43f5e },
  { bodyColor: 0x10b981, accentColor: 0xfacc15, sideColor: 0x047857, helmetColor: 0xffffff },
  { bodyColor: 0x8b5cf6, accentColor: 0xffffff, sideColor: 0x6d28d9, helmetColor: 0x06b6d4 },
  { bodyColor: 0xf97316, accentColor: 0x1e3a8a, sideColor: 0xffffff, helmetColor: 0xfacc15 },
  { bodyColor: 0xec4899, accentColor: 0x18181b, sideColor: 0xffffff, helmetColor: 0xeab308 },
  { bodyColor: 0x3b82f6, accentColor: 0xffffff, sideColor: 0x1d4ed8, helmetColor: 0xfacc15 },
];

export interface LiveryConfig {
  bodyColor: number;
  accentColor: number;
  sideColor: number;
  helmetColor: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  lapTime: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  livery: LiveryConfig;
  flag: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  speed: number;
  lap: number;
  bestLapTime: number | null;
}

const FINITE = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function colorChannel(v: unknown, fallback: number): number {
  if (!FINITE(v)) return fallback;
  const n = Math.trunc(v);
  if (n < 0 || n > 0xffffff) return fallback;
  return n;
}

/** Client -> server `livery` payloads may be hostile; coerce to a safe paint. */
export function sanitizeLivery(raw: unknown): LiveryConfig {
  const r = raw as Partial<LiveryConfig> | null | undefined;
  return {
    bodyColor: colorChannel(r?.bodyColor, 0x3b82f6),
    accentColor: colorChannel(r?.accentColor, 0xffffff),
    sideColor: colorChannel(r?.sideColor, 0x1d4ed8),
    helmetColor: colorChannel(r?.helmetColor, 0xfacc15),
  };
}

/** True when a `livery` payload is well-formed enough to accept. */
export function isValidLivery(raw: unknown): boolean {
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return false;
  return (['bodyColor', 'accentColor', 'sideColor', 'helmetColor'] as const).every(
    (k) => FINITE(r[k]) && Math.trunc(r[k] as number) >= 0 && Math.trunc(r[k] as number) <= 0xffffff,
  );
}

/** Flags are short display strings; cap length and fall back to 🏁. */
export function sanitizeFlag(raw: unknown): string {
  if (typeof raw !== 'string') return '🏁';
  const trimmed = raw.trim().slice(0, MAX_FLAG_CHARS);
  return trimmed.length > 0 ? trimmed : '🏁';
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, MAX_NAME_CHARS);
  return trimmed.length > 0 ? trimmed : fallback;
}

export interface SanitizedUpdate {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  speed: number;
  lap: number;
}

const clampNum = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Validate a client `update` payload. Returns null when the payload is
 * malformed; otherwise returns clamped, normalised values safe to broadcast.
 */
export function sanitizeUpdate(raw: unknown): SanitizedUpdate | null {
  const m = raw as Record<string, unknown> | null | undefined;
  if (!m || typeof m !== 'object') return null;
  const pos = m['position'] as Record<string, unknown> | undefined;
  const quat = m['quaternion'] as Record<string, unknown> | undefined;
  if (!pos || !quat) return null;
  if (!FINITE(pos['x']) || !FINITE(pos['y']) || !FINITE(pos['z'])) return null;
  if (!FINITE(quat['x']) || !FINITE(quat['y']) || !FINITE(quat['z']) || !FINITE(quat['w'])) {
    return null;
  }
  if (!FINITE(m['speed']) || !FINITE(m['lap'])) return null;

  const position = {
    x: clampNum(pos['x'] as number, -5000, 5000),
    y: clampNum(pos['y'] as number, -500, 2000),
    z: clampNum(pos['z'] as number, -5000, 5000),
  };

  // Normalise the quaternion so a hostile client can't inject NaN downstream.
  const qx = quat['x'] as number;
  const qy = quat['y'] as number;
  const qz = quat['z'] as number;
  const qw = quat['w'] as number;
  const len = Math.hypot(qx, qy, qz, qw);
  if (!(len > 1e-6)) return null;
  const quaternion = { x: qx / len, y: qy / len, z: qz / len, w: qw / len };

  return {
    position,
    quaternion,
    speed: clampNum(m['speed'] as number, -60, 200),
    lap: Math.min(99, Math.max(1, Math.trunc(m['lap'] as number) || 1)),
  };
}

/** Validate a `lap_completed` time. Null = reject (spam / cheat / broken). */
export function sanitizeLapTime(raw: unknown): number | null {
  if (!FINITE(raw)) return null;
  const t = raw as number;
  if (t <= MIN_LAP_TIME || t >= MAX_LAP_TIME) return null;
  return t;
}

/**
 * Insert (or improve) a leaderboard entry. Best lap per id only, sorted
 * ascending, capped at LEADERBOARD_MAX_ENTRIES. Pure: returns a new array.
 */
export function insertLeaderboard(
  list: LeaderboardEntry[],
  entry: LeaderboardEntry,
): LeaderboardEntry[] {
  const next = list.map((e) => ({ ...e }));
  const existing = next.find((e) => e.id === entry.id);
  if (existing) {
    if (entry.lapTime < existing.lapTime) {
      existing.lapTime = entry.lapTime;
      existing.name = entry.name;
    }
  } else {
    next.push({ ...entry });
  }
  next.sort((a, b) => a.lapTime - b.lapTime);
  if (next.length > LEADERBOARD_MAX_ENTRIES) next.length = LEADERBOARD_MAX_ENTRIES;
  return next;
}

/** Room ids are Durable Object names: keep them short and filesystem-safe. */
export function sanitizeRoomId(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ROOM_ID;
  const cleaned = raw.trim().slice(0, 64);
  return /^[A-Za-z0-9_-]{1,64}$/.test(cleaned) ? cleaned : DEFAULT_ROOM_ID;
}

export function makePlayerId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  const bytes = new Uint8Array(6);
  // `crypto.getRandomValues` exists in Workers and in modern Node.
  crypto.getRandomValues(bytes);
  for (const b of bytes) suffix += chars[b % chars.length];
  return `player_${suffix}`;
}

export function makePlayerName(playerId: string): string {
  return `Racer_${playerId.substring(7)}`;
}
