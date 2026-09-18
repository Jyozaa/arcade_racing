import * as THREE from 'three';

export interface TrackAtmosphere {
  // Sky + fog
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  // Lights
  sunColor: number;
  sunIntensity: number;
  sunOffset: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientIntensity: number;
  exposure: number;
  // Ground + decor
  terrainColor: number;
  mountainColors: number[];
  snowColor: number;
  snowPeakThreshold: number;
  trunkColor: number;
  foliageColors: number[];
  cloudColor: number;
  railColor: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  tagline: string;
  badge: string;
  roadWidth: number;
  curbWidth: number;
  barrierDistance: number;
  checkpointCount: number;
  controlPoints: THREE.Vector3[];
  atmosphere: TrackAtmosphere;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Original Grand Prix circuit: technical, elevation changes, hairpin.
const apexGP: TrackDefinition = {
  id: 'apex-gp',
  name: 'Apex Grand Prix',
  tagline: 'Technical • Hairpin • 2.5 km',
  badge: '🏁',
  roadWidth: 18.0,
  curbWidth: 2.0,
  barrierDistance: 14.0,
  checkpointCount: 16,
  controlPoints: [
    v(0, 0, 0),
    v(0, 0, -90),
    v(0, 0, -180),
    v(35, 1, -260),
    v(110, 3, -310),
    v(190, 5, -310),
    v(260, 4, -260),
    v(290, 2, -180),
    v(290, 1, -90),
    v(250, 0, -20),
    v(180, 1, 30),
    v(110, 3, 20),
    v(60, 4, -20),
    v(20, 3, 40),
    v(40, 2, 130),
    v(90, 1, 200),
    v(100, 0, 270),
    v(70, 0, 340),
    v(0, 1, 380),
    v(-80, 3, 370),
    v(-160, 5, 320),
    v(-220, 4, 240),
    v(-250, 2, 140),
    v(-250, 1, 40),
    v(-220, 0, -50),
    v(-160, 0, -110),
    v(-90, 0, -100),
    v(-50, 0, -40),
    v(-40, 0, 50),
    v(-25, 0, 110),
    v(0, 0, 90),
  ],
  atmosphere: {
    skyColor: 0x38bdf8,
    fogColor: 0x7dd3fc,
    fogDensity: 0.0016,
    sunColor: 0xfffbeb,
    sunIntensity: 2.1,
    sunOffset: [120, 200, 100],
    hemiSky: 0xbae6fd,
    hemiGround: 0x4ade80,
    hemiIntensity: 0.85,
    ambientIntensity: 1.25,
    exposure: 1.05,
    terrainColor: 0x4ade80,
    mountainColors: [0x3b82f6, 0x60a5fa, 0x93c5fd, 0x2563eb],
    snowColor: 0xffffff,
    snowPeakThreshold: 150,
    trunkColor: 0x78350f,
    foliageColors: [0x15803d, 0x16a34a],
    cloudColor: 0xffffff,
    railColor: 0x2563eb,
  },
};

// Sunset Grand Prix: sweepers, rhythm south section, west lobe.
const sunsetOval: TrackDefinition = {
  id: 'sunset-oval',
  name: 'Sunset GP',
  tagline: 'Grand Prix • Sweepers • 2.0 km',
  badge: '🌅',
  roadWidth: 20.0,
  curbWidth: 2.0,
  barrierDistance: 15.0,
  checkpointCount: 14,
  controlPoints: [
    v(0, 0, 0),
    v(0, 0, -132),
    v(18, 0, -240),
    v(84, 1.2, -324),
    v(192, 1.5, -360),
    v(300, 1.5, -336),
    v(396, 0, -264),
    v(432, 0, -144),
    v(396, 0, -36),
    v(312, 0, 24),
    v(252, 1.2, 96),
    v(258, 1.2, 192),
    v(210, 1.5, 250),
    v(120, 2, 292),
    v(20, 2, 298),
    v(-70, 1.5, 278),
    v(-130, 1, 230),
    v(-160, 0, 150),
    v(-130, 0, 85),
    v(-75, 0, 65),
  ],
  atmosphere: {
    skyColor: 0xffb36b,
    fogColor: 0xfdba74,
    fogDensity: 0.0021,
    sunColor: 0xffe3b3,
    sunIntensity: 2.4,
    sunOffset: [220, 85, 60],
    hemiSky: 0xffd9a8,
    hemiGround: 0xb45309,
    hemiIntensity: 0.75,
    ambientIntensity: 1.05,
    exposure: 1.1,
    terrainColor: 0xd9a441,
    mountainColors: [0x7c3aed, 0xa78bfa, 0xc4b5fd, 0x6d28d9],
    snowColor: 0xffe7c7,
    snowPeakThreshold: 170,
    trunkColor: 0x5b3413,
    foliageColors: [0xea580c, 0xf59e0b],
    cloudColor: 0xffe7c7,
    railColor: 0xea580c,
  },
};

// Ridge Grand Prix: narrow, eastern lobe, tall western fold-back.
const ridgeRun: TrackDefinition = {
  id: 'ridge-run',
  name: 'Ridge Run',
  tagline: 'Twisty • Narrow • 2.0 km',
  badge: '⛰️',
  roadWidth: 15.0,
  curbWidth: 1.6,
  barrierDistance: 12.0,
  checkpointCount: 16,
  controlPoints: [
    v(0, 0, 0),
    v(0, 0, -100),
    v(40, 1, -190),
    v(120, 2, -240),
    v(210, 3, -230),
    v(280, 2, -160),
    v(290, 1, -60),
    v(240, 0, 20),
    v(170, 1, 50),
    v(140, 2, 120),
    v(160, 3, 200),
    v(110, 4, 260),
    v(30, 3, 280),
    v(-50, 2, 250),
    v(-110, 1, 190),
    v(-100, 0, 110),
    v(-170, 0, 90),
    v(-235, 1, 30),
    v(-245, 0, -50),
    v(-205, 0, -120),
    v(-145, 0, -110),
    v(-115, 0, -40),
    v(-90, 0, 20),
    v(-30, 0, 55),
  ],
  atmosphere: {
    skyColor: 0x7dd3fc,
    fogColor: 0xcfe9ff,
    fogDensity: 0.0022,
    sunColor: 0xffffff,
    sunIntensity: 2.3,
    sunOffset: [120, 220, 100],
    hemiSky: 0xdbeafe,
    hemiGround: 0x34d399,
    hemiIntensity: 0.9,
    ambientIntensity: 1.3,
    exposure: 1.05,
    terrainColor: 0x34d399,
    mountainColors: [0x64748b, 0x94a3b8, 0x475569, 0x7c8aa0],
    snowColor: 0xffffff,
    snowPeakThreshold: 120,
    trunkColor: 0x4a2c12,
    foliageColors: [0x14532d, 0x166534],
    cloudColor: 0xffffff,
    railColor: 0x0ea5e9,
  },
};

// Desert Grand Prix: sweepers, Esses, flyover crossing.
const emberDunes: TrackDefinition = {
  id: 'ember-dunes',
  name: 'Ember Dunes',
  tagline: 'Desert • Double Flyover • 2.2 km',
  badge: '🏜️',
  roadWidth: 17.0,
  curbWidth: 1.8,
  barrierDistance: 13.5,
  checkpointCount: 16,
  controlPoints: [
    v(0, 0, 0),
    v(0, 0, -120),
    v(0, 0, -220),
    v(60, 1, -300),
    v(160, 2, -350),
    v(270, 2, -340),
    v(360, 1, -280),
    v(400, 0, -190),
    v(390, 0, -90),
    v(340, 1, -10),
    v(260, 1, 60),
    v(170, 2, 90),
    v(90, 2, 70),
    v(30, 5, 20),
    v(-20, 8, -40),
    v(-30, 9, -100),
    v(0, 9, -160),
    v(60, 7, -195),
    v(120, 4, -180),
    v(170, 1, -120),
    v(150, 0, -40),
    v(110, 4, -5),
    v(65, 8, 25),
    v(25, 9, 50),
    v(-15, 5, 60),
    v(-40, 1, 35),
  ],
  atmosphere: {
    skyColor: 0xf6d9a0,
    fogColor: 0xf3d3a0,
    fogDensity: 0.0028,
    sunColor: 0xfff3d6,
    sunIntensity: 2.6,
    sunOffset: [60, 260, 40],
    hemiSky: 0xfde9c8,
    hemiGround: 0xb45309,
    hemiIntensity: 0.8,
    ambientIntensity: 1.2,
    exposure: 1.08,
    terrainColor: 0xe8c47a,
    mountainColors: [0xc2703d, 0xb45309, 0xd97706, 0x9a3412],
    snowColor: 0xfff7e6,
    snowPeakThreshold: 220,
    trunkColor: 0x6b4423,
    foliageColors: [0x87a330, 0x6b8e23],
    cloudColor: 0xfff7e6,
    railColor: 0xb45309,
  },
};

// Snowy alpine Grand Prix: rhythm S-curves, fast eastern lobe.
const frostbitePass: TrackDefinition = {
  id: 'frostbite-pass',
  name: 'Frostbite Pass',
  tagline: 'Snow • Rhythm • 2.0 km',
  badge: '❄️',
  roadWidth: 16.0,
  curbWidth: 1.8,
  barrierDistance: 13.0,
  checkpointCount: 16,
  controlPoints: [
    v(0, 0, 0),
    v(0, 0, -100),
    v(-40, 1, -190),
    v(-120, 2, -240),
    v(-210, 3, -230),
    v(-280, 2, -160),
    v(-290, 1, -60),
    v(-240, 0, 20),
    v(-170, 1, 50),
    v(-140, 2, 120),
    v(-160, 3, 200),
    v(-110, 4, 260),
    v(-30, 3, 280),
    v(50, 2, 250),
    v(110, 1, 190),
    v(100, 0, 110),
    v(180, 1, 90),
    v(240, 1, 30),
    v(250, 0, -50),
    v(215, 0, -95),
    v(160, 0, -80),
    v(120, 0, -30),
    v(90, 0, 20),
    v(30, 0, 50),
    v(-30, 0, 70),
  ],
  atmosphere: {
    skyColor: 0x9db8dd,
    fogColor: 0xc9d9ee,
    fogDensity: 0.0024,
    sunColor: 0xdfe9ff,
    sunIntensity: 1.9,
    sunOffset: [-140, 170, 90],
    hemiSky: 0xc7d7f2,
    hemiGround: 0x8fa8c8,
    hemiIntensity: 0.85,
    ambientIntensity: 1.15,
    exposure: 1.0,
    terrainColor: 0xe8eef5,
    mountainColors: [0x8fa8c8, 0xa9bedd, 0x7d94b5, 0xb9c9e2],
    snowColor: 0xffffff,
    snowPeakThreshold: 90,
    trunkColor: 0x3f2d1c,
    foliageColors: [0x1f4d3a, 0x276749],
    cloudColor: 0xf2f6fc,
    railColor: 0x38bdf8,
  },
};

export const TRACKS: TrackDefinition[] = [apexGP, sunsetOval, ridgeRun, emberDunes, frostbitePass];

export function getTrackDef(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
