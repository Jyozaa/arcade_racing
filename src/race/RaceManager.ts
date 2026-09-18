import * as THREE from 'three';
import { PlayerCar } from '../car/PlayerCar';
import { AICar } from '../car/AICar';
import { CarBase } from '../car/CarBase';
import { TrackData } from '../track/TrackData';
import { AudioEngine } from './AudioEngine';

export type RaceState = 'COUNTDOWN' | 'RACING' | 'CUTSCENE' | 'FINISHED' | 'PAUSED';
export type GameMode = 'AI_RACE' | 'OPEN_TRACK';
export type Difficulty = 'ROOKIE' | 'PRO' | 'ACE';

export interface RaceStats {
  position: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  currentTime: number;
  bestLapTime: number;
  isFinished: boolean;
  finalPosition: number;
  mode: GameMode;
  winnerName: string | null;
  winnerIsPlayer: boolean;
  hasWinner: boolean;
  cutsceneProgress: number;
}

export class RaceManager {
  public mode: GameMode = 'AI_RACE';
  public state: RaceState = 'COUNTDOWN';
  public totalLaps: number = 3;
  public difficulty: Difficulty = 'PRO';
  // Countdown stage for the gantry lights.
  public countdownStage: number = -1;

  public playerCar: PlayerCar;
  public aiCars: AICar[] = [];
  public allCars: CarBase[] = [];

  private trackData: TrackData;
  private audioEngine: AudioEngine;
  public onLapCompleted?: (lapTime: number) => void;
  public onRaceWinner?: (winnerName: string, winnerIsPlayer: boolean) => void;
  public onPlayerFinished?: () => void;

  public raceTimer: number = 0;
  public currentLapTime: number = 0;
  public bestLapTime: number = Infinity;
  public lapHistory: number[] = [];

  public countdownTimer: number = 3.5; // 3, 2, 1, GO!
  private lastCountdownSecond: number = 4;

  public playerRank: number = 1;
  private sortedStandings: CarBase[] = [];

  public winnerName: string | null = null;
  public winnerIsPlayer: boolean = false;
  public hasWinner: boolean = false;

  public cutsceneTimer: number = 0;
  public cutsceneDuration: number = 3.5;
  public playerFinishTime: number = 0;
  public cutsceneControllingCamera: boolean = false;

  constructor(trackData: TrackData, playerCar: PlayerCar, aiCars: AICar[], audioEngine: AudioEngine) {
    this.trackData = trackData;
    this.playerCar = playerCar;
    this.aiCars = aiCars;
    this.audioEngine = audioEngine;
    this.allCars = [playerCar, ...aiCars];
  }

  public setMode(mode: GameMode) {
    this.mode = mode;
    this.setupStartingGrid();
  }

  public setTrackData(trackData: TrackData) {
    this.trackData = trackData;
  }

  public setLaps(laps: number) {
    this.totalLaps = THREE.MathUtils.clamp(Math.round(laps), 1, 9);
  }

  public setDifficulty(d: Difficulty) {
    this.difficulty = d;
    const baseScale = d === 'ROOKIE' ? 0.90 : d === 'ACE' ? 1.03 : 0.965;
    // Derive from personality every time so repeat calls don't stack.
    for (const ai of this.aiCars) {
      ai.maxSpeedRoad = 62.0 * ai.personality.speedFactor * baseScale;
    }
  }

  public setupStartingGrid() {
    this.raceTimer = 0;
    this.currentLapTime = 0;
    this.bestLapTime = Infinity;
    this.lapHistory = [];
    this.playerRank = 1;
    this.sortedStandings = [];
    this.winnerName = null;
    this.winnerIsPlayer = false;
    this.hasWinner = false;
    this.cutsceneTimer = 0;
    this.cutsceneControllingCamera = false;
    this.playerFinishTime = 0;
    this.countdownStage = -1;

    if (this.mode === 'OPEN_TRACK') {
      this.state = 'RACING';
      this.playerCar.currentLap = 1;
      this.playerCar.currentCheckpoint = 0;
      this.playerCar.isFinished = false;
      this.playerCar.finishTime = 0;
      this.playerCar.raceProgress = 0;
      this.playerCar.resetToTrack(0.995, 0); // start line facing forward
      this.allCars = [this.playerCar];
      return;
    }

    this.state = 'COUNTDOWN';
    this.countdownTimer = 3.8;
    this.lastCountdownSecond = 4;
    this.allCars = [this.playerCar, ...this.aiCars];

    const gridPositions = [
      { t: 0.994, offset: 3.2 },   // Player: Row 1 Right
      { t: 0.994, offset: -3.2 },  // AI 1: Row 1 Left
      { t: 0.980, offset: 3.2 },   // AI 2: Row 2 Right
      { t: 0.980, offset: -3.2 },  // AI 3: Row 2 Left
      { t: 0.966, offset: 3.2 },   // AI 4: Row 3 Right
      { t: 0.966, offset: -3.2 },  // AI 5: Row 3 Left
      { t: 0.952, offset: 3.2 },   // AI 6: Row 4 Right
      { t: 0.952, offset: -3.2 },  // AI 7: Row 4 Left
    ];

    this.playerCar.currentLap = 1;
    this.playerCar.currentCheckpoint = 0;
    this.playerCar.isFinished = false;
    this.playerCar.finishTime = 0;
    this.playerCar.raceProgress = 0;
    this.playerCar.resetToTrack(gridPositions[0].t, gridPositions[0].offset);

    for (let i = 0; i < this.aiCars.length; i++) {
      const ai = this.aiCars[i];
      const grid = gridPositions[i + 1] || { t: 0.96 - i * 0.01, offset: 0 };
      ai.resetRaceState();
      ai.currentLap = 1;
      ai.currentCheckpoint = 0;
      ai.isFinished = false;
      ai.resetToTrack(grid.t, grid.offset);
    }
  }

  public update(delta: number): { countdownText: string | null } {
    if (this.state === 'PAUSED' || this.state === 'FINISHED') {
      return { countdownText: null };
    }

    let countdownText: string | null = null;

    if (this.state === 'CUTSCENE') {
      this.raceTimer += delta;
      this.cutsceneTimer += delta;
      for (const car of this.allCars) {
        if (car.isFinished) continue;
        this.checkCarProgress(car);
      }
      this.resolveCarCollisions();
      this.calculateRankings();
      if (this.cutsceneTimer >= this.cutsceneDuration) {
        this.state = 'FINISHED';
        this.cutsceneControllingCamera = false;
        this.audioEngine.playFinishFanfare();
      }
      return { countdownText: null };
    }

    if (this.state === 'COUNTDOWN') {
      this.countdownTimer -= delta;

      const currentSec = Math.ceil(this.countdownTimer);
      if (currentSec > 0 && currentSec !== this.lastCountdownSecond) {
        this.lastCountdownSecond = currentSec;
        countdownText = currentSec.toString();
        this.countdownStage = currentSec;
        this.audioEngine.playCountdownBeep(false);
      }

      if (this.countdownTimer <= 0) {
        this.state = 'RACING';
        countdownText = 'GO!';
        this.countdownStage = 0;
        this.audioEngine.playCountdownBeep(true);
      } else if (this.countdownTimer > 0 && this.countdownTimer <= 1.0) {
        countdownText = '1';
        this.countdownStage = 1;
      } else if (this.countdownTimer <= 2.0) {
        countdownText = '2';
        this.countdownStage = 2;
      } else if (this.countdownTimer <= 3.0) {
        countdownText = '3';
        this.countdownStage = 3;
      }

      this.playerCar.speed = 0;
      this.playerCar.steeringInput = 0;
      for (const ai of this.aiCars) {
        ai.speed = 0;
        ai.throttleInput = 0;
      }
      return { countdownText };
    }

    if (this.state === 'RACING') {
      this.raceTimer += delta;
      this.currentLapTime += delta;
    }

    for (const car of this.allCars) {
      if (car.isFinished) continue;
      this.checkCarProgress(car);
    }

    this.resolveCarCollisions();

    this.calculateRankings();

    return { countdownText: null };
  }

  private checkCarProgress(car: CarBase) {
    const totalCP = this.trackData.checkpointCount;
    const nextCPIndex = (car.currentCheckpoint + 1) % totalCP;
    const nextCP = this.trackData.checkpoints[nextCPIndex];

    const distToCP = car.position.distanceTo(nextCP.position);
    if (distToCP < 22.0) {
      car.currentCheckpoint = nextCPIndex;

      if (nextCPIndex === 0) {
        if (this.mode === 'OPEN_TRACK') {
          car.currentLap++;
          if (car === this.playerCar) {
            const lapTime = this.currentLapTime;
            if (lapTime < this.bestLapTime) {
              this.bestLapTime = lapTime;
            }
            this.lapHistory.push(lapTime);
            this.currentLapTime = 0;
            this.audioEngine.playLapChime();
            if (this.onLapCompleted) {
              this.onLapCompleted(lapTime);
            }
          }
          return;
        }

        if (car.currentLap < this.totalLaps) {
          car.currentLap++;
          if (car === this.playerCar) {
            if (this.currentLapTime < this.bestLapTime) {
              this.bestLapTime = this.currentLapTime;
            }
            this.lapHistory.push(this.currentLapTime);
            this.currentLapTime = 0;
            this.audioEngine.playLapChime();
          }
        } else {
          car.isFinished = true;
          car.finishTime = this.raceTimer;

          if (!this.hasWinner) {
            this.hasWinner = true;
            this.winnerIsPlayer = car === this.playerCar;
            this.winnerName = this.winnerIsPlayer
              ? 'YOU'
              : (car instanceof AICar ? car.personality.name : 'RIVAL');
            if (this.onRaceWinner) {
              this.onRaceWinner(this.winnerName, this.winnerIsPlayer);
            }
          }

          if (car === this.playerCar) {
            if (this.currentLapTime < this.bestLapTime) {
              this.bestLapTime = this.currentLapTime;
            }
            this.lapHistory.push(this.currentLapTime);
            this.playerFinishTime = this.raceTimer;
            this.state = 'CUTSCENE';
            this.cutsceneTimer = 0;
            this.cutsceneControllingCamera = true;
            if (this.onPlayerFinished) {
              this.onPlayerFinished();
            }
          } else if (car instanceof AICar) {
          }
        }
      }
    }
  }

  // Rank by race progress; also updates AI rubber-banding.
  private calculateRankings() {
    if (this.mode === 'OPEN_TRACK') {
      this.playerRank = 1;
      return;
    }

    const sorted = [...this.allCars].sort((a, b) => {
      if (a.isFinished && !b.isFinished) return -1;
      if (!a.isFinished && b.isFinished) return 1;
      if (a.isFinished && b.isFinished) return a.finishTime - b.finishTime;

      if (a.currentLap !== b.currentLap) {
        return b.currentLap - a.currentLap;
      }
      return b.raceProgress - a.raceProgress;
    });

    this.sortedStandings = sorted;
    this.playerRank = sorted.indexOf(this.playerCar) + 1;

    // Rubber-band on progress gap: trailers speed up, leaders ease off.
    const playerProgress = this.playerCar.raceProgress;
    const strength = this.difficulty === 'ROOKIE' ? 1.4 : this.difficulty === 'ACE' ? 0.6 : 1.0;
    for (const car of this.allCars) {
      if (!(car instanceof AICar) || car.isFinished) continue;
      const gap = playerProgress - car.raceProgress; // + = player ahead
      const band = THREE.MathUtils.clamp(gap * 1.6, -0.06, 0.09) * strength;
      car.rubberBand = THREE.MathUtils.damp(car.rubberBand, band, 1.2, 1 / 60);
    }
  }

  public getStandings(): CarBase[] {
    return this.sortedStandings.length > 0 ? [...this.sortedStandings] : [...this.allCars];
  }

  public getCarDisplayName(car: CarBase): string {
    if (car === this.playerCar) return 'YOU';
    if (car instanceof AICar) return car.personality.name;
    return 'RIVAL';
  }

  private resolveCarCollisions() {
    for (let i = 0; i < this.allCars.length; i++) {
      for (let j = i + 1; j < this.allCars.length; j++) {
        const c1 = this.allCars[i];
        const c2 = this.allCars[j];

        const dist = c1.position.distanceTo(c2.position);
        const minDist = c1.collisionRadius + c2.collisionRadius;

        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const normal = new THREE.Vector3().subVectors(c1.position, c2.position).normalize();

          c1.position.addScaledVector(normal, overlap * 0.5);
          c2.position.addScaledVector(normal, -overlap * 0.5);

          const closing = Math.abs(c1.speed - c2.speed);
          const impact = THREE.MathUtils.clamp(0.2 + closing / 30, 0.2, 1);
          c1.lastImpact = Math.max(c1.lastImpact, impact * 0.9);
          c2.lastImpact = Math.max(c2.lastImpact, impact * 0.9);

          const avgSpeed = (c1.speed + c2.speed) * 0.5;
          c1.speed = avgSpeed * 0.95;
          c2.speed = avgSpeed * 0.95;
        }
      }
    }
  }

  public getStats(): RaceStats {
    // Freeze the clock at the player's finish; AI keep racing behind.
    const playerTime = this.playerCar.isFinished && this.playerFinishTime > 0
      ? this.playerFinishTime
      : this.raceTimer;
    return {
      position: this.playerRank,
      totalRacers: this.allCars.length,
      lap: this.playerCar.currentLap,
      totalLaps: this.totalLaps,
      currentTime: this.mode === 'OPEN_TRACK' ? this.currentLapTime : playerTime,
      bestLapTime: this.bestLapTime,
      isFinished: this.playerCar.isFinished,
      finalPosition: this.playerRank,
      mode: this.mode,
      winnerName: this.winnerName,
      winnerIsPlayer: this.winnerIsPlayer,
      hasWinner: this.hasWinner,
      cutsceneProgress: this.state === 'CUTSCENE'
        ? Math.min(1, this.cutsceneTimer / this.cutsceneDuration)
        : 0
    };
  }
}
