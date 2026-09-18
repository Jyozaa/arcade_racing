import * as THREE from 'three';
import { TrackData } from '../track/TrackData';
import { TrackMesh } from '../track/TrackMesh';
import { Environment } from '../track/Environment';
import { PlayerCar } from '../car/PlayerCar';
import { AICar, AIPersonality } from '../car/AICar';
import { ChaseCamera } from '../camera/ChaseCamera';
import { RaceManager, GameMode } from '../race/RaceManager';
import { AudioEngine } from '../race/AudioEngine';
import { HUD } from '../ui/HUD';
import { MultiplayerClient } from '../network/MultiplayerClient';
import { ParticleSystem } from '../effects/ParticleSystem';
import { getTrackDef, TrackDefinition } from '../track/tracks';
import { getCarDef, pickAiLiveries, randomLivery, FLAG_OPTIONS, TireCompound } from '../car/cars';

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: ChaseCamera;

  private trackData: TrackData;
  private trackMesh: TrackMesh;
  private environment: Environment;

  private playerCar: PlayerCar;
  private aiCars: AICar[] = [];
  private raceManager: RaceManager;
  private audioEngine: AudioEngine;
  private hud: HUD;
  private multiplayerClient: MultiplayerClient;
  private particles: ParticleSystem;
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunOffset: THREE.Vector3 = new THREE.Vector3(120, 200, 100);

  private lastTime: number = performance.now();
  private isRunning: boolean = false;
  private currentMode: GameMode = 'AI_RACE';
  private currentTrackId: string = 'apex-gp';
  private currentCarId: string = 'apex-s1';
  private inMenu: boolean = true;
  private audioSuspended: boolean = false;
  private lastGantryStage: number = -99;
  private prevPlayerImpact: number = 0;
  private exhaustTmp: THREE.Vector3 = new THREE.Vector3();

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // Renderer
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance'
      });
    } catch (err) {
      this.showFatal(
        'WebGL is unavailable in this browser, so Apex GP cannot start. ' +
        'Please enable hardware acceleration or try a recent Chrome, Edge, Firefox, or Safari.'
      );
      throw err instanceof Error ? err : new Error('WebGL unavailable');
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Scene
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x38bdf8); // Vibrant arcade azure blue
    this.scene.background = skyColor;
    this.scene.fog = new THREE.FogExp2(0x7dd3fc, 0.0016);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
    this.scene.add(ambientLight);
    this.ambientLight = ambientLight;

    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x4ade80, 0.85);
    this.scene.add(hemiLight);
    this.hemiLight = hemiLight;

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.1);
    sunLight.position.set(120, 200, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 600;
    const d = 160;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);
    this.sunLight = sunLight;

    // Track
    const bootDef = getTrackDef(this.currentTrackId);
    this.trackData = new TrackData(bootDef);
    this.trackMesh = new TrackMesh(this.trackData, bootDef.atmosphere.railColor);
    this.scene.add(this.trackMesh.group);

    this.environment = new Environment(this.trackData, bootDef.atmosphere);
    this.scene.add(this.environment.group);
    this.applyAtmosphere(bootDef);

    // Cars
    this.playerCar = new PlayerCar(this.trackData);
    this.scene.add(this.playerCar.group);

    this.createAICars();
    this.assignAiLiveries();
    try {
      const saved = localStorage.getItem('apexgp_flag');
      if (saved) this.playerCar.setFlag(saved);
    } catch { /* private mode */ }
    this.assignAiFlags();

    // Systems
    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.audioEngine = new AudioEngine();
    this.raceManager = new RaceManager(this.trackData, this.playerCar, this.aiCars, this.audioEngine);
    this.hud = new HUD(this.playerCar, this.raceManager, this.trackData, this.audioEngine);

    this.particles = new ParticleSystem(900);
    this.scene.add(this.particles.points);

    this.multiplayerClient = new MultiplayerClient(this.scene, this.playerCar, (leaderboard) => {
      this.hud.updateLeaderboard(leaderboard, this.multiplayerClient.localPlayerId);
    });
    this.hud.getRemoteDots = () => this.multiplayerClient.getRemoteDots();
    this.hud.getNetStatus = () => this.multiplayerClient.status;

    this.raceManager.onLapCompleted = (lapTime) => {
      if (this.currentMode === 'OPEN_TRACK') {
        this.multiplayerClient.notifyLapCompleted(lapTime);
      }
    };

    this.hud.onSelectMode = (mode) => {
      this.startMode(mode);
    };
    this.hud.onSelectTrack = (trackId) => {
      this.switchTrack(trackId);
    };
    this.hud.onSelectCar = (carId) => {
      this.applyCar(carId);
    };
    this.hud.onSelectFlag = (emoji) => {
      this.applyFlag(emoji);
    };
    this.hud.onQuitToMenu = () => {
      this.quitToMenu();
    };

    this.camera.reset(this.playerCar);

    this.raceManager.state = 'PAUSED';

    window.addEventListener('resize', this.onResize.bind(this));

    const unlockAudio = () => {
      this.audioEngine.init();
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
    };
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('pointerdown', unlockAudio);

    this.isRunning = true;
    this.lastTime = performance.now();
    this.tick();
  }

  private startMode(mode: GameMode) {
    this.currentMode = mode;
    this.inMenu = false;

    if (mode === 'AI_RACE') {
      this.multiplayerClient.disconnect();

      // Re-apply the picked car so the AI grid still excludes its color.
      this.applyCar(this.currentCarId);
      this.assignAiFlags();

      for (const ai of this.aiCars) {
        if (!this.scene.children.includes(ai.group)) {
          this.scene.add(ai.group);
        }
      }
      this.raceManager.setMode('AI_RACE');
      this.camera.reset(this.playerCar);
    } else {
      // Open track: fixed handling, random paint.
      this.playerCar.applyCarDef({ ...getCarDef('apex-s1'), livery: randomLivery() });
      for (const ai of this.aiCars) {
        this.scene.remove(ai.group);
      }

      this.raceManager.setMode('OPEN_TRACK');
      this.multiplayerClient.connect(undefined, this.playerCar.currentLivery, this.playerCar.flag);
      this.camera.reset(this.playerCar);
    }
  }

  private quitToMenu() {
    this.multiplayerClient.disconnect();
    this.inMenu = true;
    this.raceManager.state = 'PAUSED';
    this.hud.showMenu();
    this.camera.reset(this.playerCar);
  }

  private switchTrack(trackId: string) {
    const def = getTrackDef(trackId);
    if (def.id === this.currentTrackId && this.trackMesh.group.children.length > 0) {
      return;
    }
    this.currentTrackId = def.id;

    this.scene.remove(this.trackMesh.group);
    this.trackMesh.dispose();
    this.scene.remove(this.environment.group);
    this.environment.dispose();

    this.trackData = new TrackData(def);
    this.trackMesh = new TrackMesh(this.trackData, def.atmosphere.railColor);
    this.scene.add(this.trackMesh.group);
    this.environment = new Environment(this.trackData, def.atmosphere);
    this.scene.add(this.environment.group);
    this.applyAtmosphere(def);

    this.playerCar.trackData = this.trackData;
    for (const ai of this.aiCars) ai.trackData = this.trackData;
    this.raceManager.setTrackData(this.trackData);
    this.hud.setTrackData(this.trackData);

    this.lastGantryStage = -99;
    this.trackMesh.setCountdownStage(-1);
    if (this.inMenu) {
      const keepMode = this.currentMode;
      this.raceManager.setMode(keepMode);
      this.raceManager.state = 'PAUSED';
    } else {
      this.raceManager.setupStartingGrid();
    }
    this.camera.reset(this.playerCar);
  }

  private applyCar(carId: string) {
    const def = getCarDef(carId);
    this.currentCarId = def.id;
    this.playerCar.applyCarDef(def);
    this.assignAiLiveries();
  }

  // Repaint the AI grid so no two cars share a color.
  private assignAiLiveries() {
    const liveries = pickAiLiveries(this.playerCar.currentLivery?.bodyColor, this.aiCars.length);
    this.aiCars.forEach((ai, i) => ai.applyLivery(liveries[i]));
  }

  private assignAiFlags() {
    const pool = FLAG_OPTIONS.map((f) => f.emoji).filter((e) => e !== this.playerCar.flag);
    const compounds: TireCompound[] = ['SOFT', 'MEDIUM', 'HARD'];
    this.aiCars.forEach((ai, i) => {
      ai.setFlag(pool[i % pool.length]);
      ai.compound = compounds[i % compounds.length];
    });
  }

  public applyFlag(emoji: string) {
    this.playerCar.setFlag(emoji);
    try {
      localStorage.setItem('apexgp_flag', emoji);
    } catch { /* private mode */ }
    this.assignAiFlags();
  }

  private applyAtmosphere(def: TrackDefinition) {
    const a = def.atmosphere;
    (this.scene.background as THREE.Color).set(a.skyColor);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(a.fogColor);
    fog.density = a.fogDensity;
    this.sunLight.color.set(a.sunColor);
    this.sunLight.intensity = a.sunIntensity;
    this.sunOffset.set(a.sunOffset[0], a.sunOffset[1], a.sunOffset[2]);
    this.hemiLight.color.set(a.hemiSky);
    this.hemiLight.groundColor.set(a.hemiGround);
    this.hemiLight.intensity = a.hemiIntensity;
    this.ambientLight.intensity = a.ambientIntensity;
    this.renderer.toneMappingExposure = a.exposure;
  }

  private createAICars() {
    const aiConfigs: {
      color: { bodyColor: number; accentColor: number; sideColor: number; helmetColor: number };
      personality: AIPersonality;
    }[] = [
      {
        color: { bodyColor: 0xeab308, accentColor: 0x18181b, sideColor: 0xf97316, helmetColor: 0xffffff },
        personality: { name: 'Vortex', speedFactor: 1.01, cornerAggression: 0.90, laneOffset: -1.8 }
      },
      {
        color: { bodyColor: 0x06b6d4, accentColor: 0xffffff, sideColor: 0x0284c7, helmetColor: 0xf43f5e },
        personality: { name: 'Cygnus', speedFactor: 0.97, cornerAggression: 0.85, laneOffset: 1.6 }
      },
      {
        color: { bodyColor: 0xf97316, accentColor: 0xffffff, sideColor: 0x1e3a8a, helmetColor: 0xffffff },
        personality: { name: 'Phoenix', speedFactor: 0.99, cornerAggression: 0.88, laneOffset: 0.0 }
      },
      {
        color: { bodyColor: 0x8b5cf6, accentColor: 0xfacc15, sideColor: 0x6d28d9, helmetColor: 0x06b6d4 },
        personality: { name: 'Shadow', speedFactor: 0.96, cornerAggression: 0.82, laneOffset: -2.2 }
      },
      {
        color: { bodyColor: 0x10b981, accentColor: 0xfacc15, sideColor: 0x047857, helmetColor: 0xeab308 },
        personality: { name: 'Apex', speedFactor: 1.00, cornerAggression: 0.89, laneOffset: 2.0 }
      },
      {
        color: { bodyColor: 0xec4899, accentColor: 0x18181b, sideColor: 0xffffff, helmetColor: 0xffffff },
        personality: { name: 'Nitro', speedFactor: 0.95, cornerAggression: 0.80, laneOffset: -0.9 }
      },
      {
        color: { bodyColor: 0x3b82f6, accentColor: 0xffffff, sideColor: 0x1d4ed8, helmetColor: 0xfacc15 },
        personality: { name: 'Blaze', speedFactor: 0.98, cornerAggression: 0.87, laneOffset: 1.1 }
      }
    ];

    for (const cfg of aiConfigs) {
      const ai = new AICar(this.trackData, cfg.color, cfg.personality);
      this.aiCars.push(ai);
      this.scene.add(ai.group);
    }
  }

  private onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.setAspectRatio(width / height);
  }

  // Unrecoverable startup failure (no WebGL).
  private showFatal(message: string) {
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.inset = '0';
    div.style.zIndex = '9999';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.padding = '32px';
    div.style.background = '#0b1220';
    div.style.color = '#f8fafc';
    div.style.fontFamily = 'system-ui, sans-serif';
    div.style.fontSize = '1.05rem';
    div.style.textAlign = 'center';
    div.textContent = message;
    document.body.appendChild(div);
  }

  private tick = () => {
    if (!this.isRunning) return;

    requestAnimationFrame(this.tick);

    const now = performance.now();
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (delta > 0.1) delta = 0.1;

    // Car loops would otherwise freeze at their last gain behind UI.
    const shouldSuspendAudio =
      this.raceManager.state === 'PAUSED' || this.raceManager.state === 'FINISHED';
    if (shouldSuspendAudio !== this.audioSuspended) {
      this.audioSuspended = shouldSuspendAudio;
      this.audioEngine.setSuspended(shouldSuspendAudio);
    }

    const { countdownText } = this.raceManager.update(delta);

    // Sync gantry lights with the countdown.
    if (this.raceManager.countdownStage !== this.lastGantryStage) {
      this.lastGantryStage = this.raceManager.countdownStage;
      this.trackMesh.setCountdownStage(this.lastGantryStage);
      if (this.lastGantryStage === 0) {
        setTimeout(() => {
          this.trackMesh.setCountdownStage(-1);
          this.lastGantryStage = -1;
        }, 2500);
      }
    }

    if (this.raceManager.state !== 'PAUSED') {
      const racing = this.raceManager.state === 'RACING';
      const cutscene = this.raceManager.state === 'CUTSCENE';

      if (racing || cutscene) {
        this.playerCar.update(delta);

        // Finished AI keep rolling so the winner doesn't freeze at the line.
        if (this.currentMode === 'AI_RACE') {
          for (const ai of this.aiCars) {
            ai.updateAI(delta, this.raceManager.allCars);
          }
        }
      }

      if (this.currentMode === 'OPEN_TRACK') {
        this.multiplayerClient.update(delta);
      }

      if (this.raceManager.state !== 'FINISHED') {
        if (cutscene && this.currentMode === 'AI_RACE') {
          const stats = this.raceManager.getStats();
          this.camera.updateCutscene(this.playerCar, stats.cutsceneProgress, delta);
        } else {
          this.camera.update(this.playerCar, delta);
        }
      }

      // Shadow frustum follows the player.
      this.sunLight.target.position.copy(this.playerCar.position);
      this.sunLight.position.copy(this.playerCar.position).add(this.sunOffset);
      this.sunLight.target.updateMatrixWorld();

      this.updateEffects(delta);

      this.environment.update(delta);

      const speedRatio = Math.abs(this.playerCar.speed) / this.playerCar.maxSpeedRoad;
      const isAccel = this.playerCar.throttleInput > 0;
      this.audioEngine.updateEngine(speedRatio, isAccel, this.playerCar.isDrifting);
      this.audioEngine.updateNitro(this.playerCar.nitroActive);

      this.particles.update(delta);
    }

    this.hud.update(countdownText);

    this.renderer.render(this.scene, this.camera.camera);
  };

  private updateEffects(delta: number) {
    const p = this.playerCar;
    void delta;

    // Impact edge: shake + thud + sparks.
    if (p.lastImpact > 0.35 && this.prevPlayerImpact <= 0.35) {
      this.camera.addShake(Math.min(0.8, p.lastImpact * 0.8));
      this.audioEngine.playCollision(p.lastImpact);
      this.exhaustTmp.copy(p.position).add(new THREE.Vector3(0, 0.8, 0));
      this.particles.emitSparks(this.exhaustTmp, 8);
    } else if (p.isCollidingBarrier && Math.abs(p.speed) > 12 && Math.random() < 0.35) {
      this.exhaustTmp.copy(p.position).addScaledVector(p.forward, 1.2).add(new THREE.Vector3(0, 0.6, 0));
      this.particles.emitSparks(this.exhaustTmp, 2);
    }
    this.prevPlayerImpact = p.lastImpact;

    if (p.isDrifting && Math.abs(p.speed) > 8) {
      this.exhaustTmp.copy(p.position).addScaledVector(p.forward, -1.4).add(new THREE.Vector3(0, 0.35, 0));
      this.particles.emitDriftSmoke(this.exhaustTmp, Math.abs(p.speed));
      if (Math.random() < 0.6) this.particles.emitDriftSmoke(this.exhaustTmp, Math.abs(p.speed));
    }
    if (!p.isOnRoad && Math.abs(p.speed) > 8 && Math.random() < 0.7) {
      this.exhaustTmp.copy(p.position).add(new THREE.Vector3(0, 0.3, 0));
      this.particles.emitGrassDust(this.exhaustTmp);
    }
    if (p.nitroActive) {
      this.exhaustTmp.copy(p.position).addScaledVector(p.forward, -1.8).add(new THREE.Vector3(0, 0.45, 0));
      this.particles.emitNitro(this.exhaustTmp, p.forward);
      this.particles.emitNitro(this.exhaustTmp, p.forward);
    }

    // Nearby AI effects only.
    if (this.currentMode === 'AI_RACE') {
      for (const ai of this.aiCars) {
        if (ai.position.distanceToSquared(p.position) > 70 * 70) continue;
        if (ai.isDrifting && Math.abs(ai.speed) > 8 && Math.random() < 0.5) {
          this.exhaustTmp.copy(ai.position).addScaledVector(ai.forward, -1.4).add(new THREE.Vector3(0, 0.35, 0));
          this.particles.emitDriftSmoke(this.exhaustTmp, Math.abs(ai.speed));
        }
        if (ai.nitroActive && Math.random() < 0.8) {
          this.exhaustTmp.copy(ai.position).addScaledVector(ai.forward, -1.8).add(new THREE.Vector3(0, 0.45, 0));
          this.particles.emitNitro(this.exhaustTmp, ai.forward);
        }
        if (ai.lastImpact > 0.5 && Math.random() < 0.4) {
          this.exhaustTmp.copy(ai.position).add(new THREE.Vector3(0, 0.8, 0));
          this.particles.emitSparks(this.exhaustTmp, 4);
        }
      }
    }
  }
}
