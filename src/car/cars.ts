import { CarColorConfig } from './CarModel';

export interface CarDefinition {
  id: string;
  name: string;
  tagline: string;
  livery: CarColorConfig;
  maxSpeedRoad: number;
  accelerationRate: number;
  turnSpeed: number;
  nitroBoostPower: number;
}

export const CARS: CarDefinition[] = [
  {
    id: 'apex-s1',
    name: 'Apex S1',
    tagline: 'Balanced all-rounder',
    livery: {
      bodyColor: 0xef4444,
      accentColor: 0xf8fafc,
      sideColor: 0x2563eb,
      helmetColor: 0xfacc15,
      numberColor: 0xffffff,
    },
    maxSpeedRoad: 62.0,
    accelerationRate: 32.0,
    turnSpeed: 2.4,
    nitroBoostPower: 22.0,
  },
  {
    id: 'velocity-x',
    name: 'Velocity X',
    tagline: 'Top speed monster',
    livery: {
      bodyColor: 0xeab308,
      accentColor: 0x18181b,
      sideColor: 0xf97316,
      helmetColor: 0xffffff,
    },
    maxSpeedRoad: 66.0,
    accelerationRate: 29.0,
    turnSpeed: 2.15,
    nitroBoostPower: 24.0,
  },
  {
    id: 'grip-gt',
    name: 'Grip GT',
    tagline: 'Cornering specialist',
    livery: {
      bodyColor: 0x06b6d4,
      accentColor: 0xffffff,
      sideColor: 0x0284c7,
      helmetColor: 0xf43f5e,
    },
    maxSpeedRoad: 59.0,
    accelerationRate: 33.0,
    turnSpeed: 2.7,
    nitroBoostPower: 20.0,
  },
  {
    id: 'night-drift',
    name: 'Night Drift',
    tagline: 'Drift + nitro play',
    livery: {
      bodyColor: 0x8b5cf6,
      accentColor: 0xfacc15,
      sideColor: 0x6d28d9,
      helmetColor: 0x06b6d4,
    },
    maxSpeedRoad: 60.0,
    accelerationRate: 34.0,
    turnSpeed: 2.55,
    nitroBoostPower: 26.0,
  },
];

export function getCarDef(id: string): CarDefinition {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

export interface FlagOption {
  code: string;
  name: string;
  emoji: string;
}

export const FLAG_OPTIONS: FlagOption[] = [
  { code: 'INT', name: 'International', emoji: '🏁' },
  { code: 'GBR', name: 'United Kingdom', emoji: '🇬🇧' },
  { code: 'USA', name: 'United States', emoji: '🇺🇸' },
  { code: 'GER', name: 'Germany', emoji: '🇩🇪' },
  { code: 'FRA', name: 'France', emoji: '🇫🇷' },
  { code: 'ITA', name: 'Italy', emoji: '🇮🇹' },
  { code: 'ESP', name: 'Spain', emoji: '🇪🇸' },
  { code: 'NED', name: 'Netherlands', emoji: '🇳🇱' },
  { code: 'MEX', name: 'Mexico', emoji: '🇲🇽' },
  { code: 'AUS', name: 'Australia', emoji: '🇦🇺' },
  { code: 'JPN', name: 'Japan', emoji: '🇯🇵' },
  { code: 'BRA', name: 'Brazil', emoji: '🇧🇷' },
  { code: 'CAN', name: 'Canada', emoji: '🇨🇦' },
  { code: 'AUT', name: 'Austria', emoji: '🇦🇹' },
  { code: 'BEL', name: 'Belgium', emoji: '🇧🇪' },
  { code: 'POR', name: 'Portugal', emoji: '🇵🇹' },
];

export type TireCompound = 'SOFT' | 'MEDIUM' | 'HARD';

export const TIRE_COLORS: Record<TireCompound, string> = {
  SOFT: '#e10600',
  MEDIUM: '#ffd12e',
  HARD: '#e8e8e8',
};

export function driverCode(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (clean.slice(0, 3) || 'RAC').padEnd(3, 'X');
}

export function formatGap(
  leaderLap: number, leaderProgress: number, leaderSpeed: number,
  lap: number, progress: number, totalLength: number,
): string {
  const lapDiff = leaderLap - lap;
  if (lapDiff > 0) return `+${lapDiff} LAP`;
  const gapSec = Math.max(0, (leaderProgress - progress) * totalLength / Math.max(25, leaderSpeed));
  return `+${gapSec.toFixed(3)}`;
}

// Paint pool for AI grids + open-track assignment (12 entries, no repeats).
export const AI_LIVERY_POOL: CarColorConfig[] = [
  { bodyColor: 0xef4444, accentColor: 0xf8fafc, sideColor: 0x2563eb, helmetColor: 0xfacc15 }, // red
  { bodyColor: 0xeab308, accentColor: 0x18181b, sideColor: 0xf97316, helmetColor: 0xffffff }, // yellow
  { bodyColor: 0x06b6d4, accentColor: 0xffffff, sideColor: 0x0284c7, helmetColor: 0xf43f5e }, // cyan
  { bodyColor: 0x8b5cf6, accentColor: 0xfacc15, sideColor: 0x6d28d9, helmetColor: 0x06b6d4 }, // purple
  { bodyColor: 0xf8fafc, accentColor: 0x18181b, sideColor: 0xef4444, helmetColor: 0x18181b }, // white stealth
  { bodyColor: 0xa3e635, accentColor: 0x1a2e05, sideColor: 0x4d7c0f, helmetColor: 0xffffff }, // lime
  { bodyColor: 0x14b8a6, accentColor: 0xffffff, sideColor: 0x0f766e, helmetColor: 0x18181b }, // teal
  { bodyColor: 0xe14389, accentColor: 0x18181b, sideColor: 0xffffff, helmetColor: 0xeab308 }, // magenta
  { bodyColor: 0x1e3a8a, accentColor: 0xfacc15, sideColor: 0x3b82f6, helmetColor: 0xffffff }, // navy
  { bodyColor: 0x991b1b, accentColor: 0xffffff, sideColor: 0x451a1a, helmetColor: 0xfacc15 }, // maroon
  { bodyColor: 0xf59e0b, accentColor: 0x451a03, sideColor: 0xb45309, helmetColor: 0xffffff }, // gold
  { bodyColor: 0x3b82f6, accentColor: 0xffffff, sideColor: 0x1d4ed8, helmetColor: 0xfacc15 }, // royal blue
];

// First `count` pool entries with a different body color than the player's.
export function pickAiLiveries(playerBodyColor: number | undefined, count: number): CarColorConfig[] {
  const available = AI_LIVERY_POOL.filter((l) => l.bodyColor !== playerBodyColor);
  const source = available.length >= count ? available : AI_LIVERY_POOL;
  const out: CarColorConfig[] = [];
  for (let i = 0; i < count; i++) out.push(source[i % source.length]);
  return out;
}

// Random pool livery for open track.
export function randomLivery(): CarColorConfig {
  return AI_LIVERY_POOL[Math.floor(Math.random() * AI_LIVERY_POOL.length)];
}
