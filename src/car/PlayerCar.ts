import * as THREE from 'three';
import { CarBase } from './CarBase';
import { TrackData } from '../track/TrackData';
import { CarColorConfig } from './CarModel';
import { CarDefinition, getCarDef } from './cars';

export class PlayerCar extends CarBase {
  private keys: { [code: string]: boolean } = {};
  public isWrongWay: boolean = false;
  private resetCooldown: number = 0;
  // Current paint; the AI grid excludes this color.
  public currentLivery: CarColorConfig;
  public flag: string = '🏁';
  // Touch-button state, written by the HUD.
  public touch: { steer: number; throttle: number; brake: boolean; nitro: boolean; drift: boolean } = {
    steer: 0, throttle: 0, brake: false, nitro: false, drift: false,
  };
  // Set by the finish cinematic: player input is ignored and the car keeps
  // rolling under a gentle pursuit autopilot instead of freezing.
  public inputLocked: boolean = false;
  public cinematicAuto: boolean = false;
  private autoTmp: THREE.Vector3 = new THREE.Vector3();

  constructor(trackData: TrackData) {
    const def = getCarDef('apex-s1');
    super(trackData, def.livery);
    this.currentLivery = def.livery;

    this.setupInputs();
  }

  // Swap paint only, keep handling.
  public applyLivery(config: CarColorConfig) {
    this.replaceModel(config);
    this.currentLivery = config;
    this.model.setFlagDecal(this.flag);
  }

  public setFlag(emoji: string) {
    this.flag = emoji;
    this.model.setFlagDecal(emoji);
  }

  // Swap to a catalog car, keeping track position.
  public applyCarDef(defOrId: CarDefinition | string) {
    const def: CarDefinition = typeof defOrId === 'string' ? getCarDef(defOrId) : defOrId;
    this.applyLivery(def.livery);
    this.maxSpeedRoad = def.maxSpeedRoad;
    this.accelerationRate = def.accelerationRate;
    this.turnSpeed = def.turnSpeed;
    this.nitroBoostPower = def.nitroBoostPower;
    this.nitroAmount = 100;
    this.nitroLocked = false;
    this.nitroActive = false;
  }

  private setupInputs() {
    window.addEventListener('keydown', (e) => {
      // Don't capture keystrokes typed into menu fields (driver name input).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      this.keys[e.code] = true;

      if (e.code === 'KeyR' && !this.inputLocked && this.resetCooldown <= 0) {
        this.resetToNearestTrackPoint();
        this.resetCooldown = 1.0; // 1s cooldown
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  public update(delta: number) {
    if (this.resetCooldown > 0) {
      this.resetCooldown -= delta;
    }

    if (this.inputLocked) {
      if (this.cinematicAuto) {
        this.updateCinematicAuto();
      } else {
        this.steeringInput = 0;
        this.throttleInput = 0;
        this.handbrake = false;
        this.nitroActive = false;
      }
      this.updatePhysics(delta);
      this.updateWrongWay();
      return;
    }

    let steer = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) steer += 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) steer -= 1;
    steer += this.touch.steer;
    this.steeringInput = THREE.MathUtils.clamp(steer, -1, 1);

    let throttle = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) throttle += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) throttle -= 1;
    throttle += this.touch.throttle;
    if (this.touch.brake) throttle -= 1;
    this.throttleInput = THREE.MathUtils.clamp(throttle, -1, 1);

    this.handbrake = !!this.keys['Space'] || this.touch.drift;

    // Raw nitro intent; the lockout logic lives in updatePhysics.
    const nitroKey = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    this.nitroActive = nitroKey || this.touch.nitro;

    this.updatePhysics(delta);

    this.updateWrongWay();
  }

  // Gentle pursuit driver for the finish cinematic: follows the racing line
  // at part throttle so the car keeps rolling naturally for the cameras.
  private updateCinematicAuto() {
    const ahead = this.trackData.getPointInfoAt(this.currentTrackT + 0.004);
    this.autoTmp.subVectors(ahead.position, this.position);
    this.autoTmp.y = 0;
    if (this.autoTmp.lengthSq() > 1e-6) {
      this.autoTmp.normalize();
      const targetYaw = Math.atan2(-this.autoTmp.x, -this.autoTmp.z);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.steeringInput = THREE.MathUtils.clamp(diff * 2.2, -0.7, 0.7);
    } else {
      this.steeringInput = 0;
    }
    this.throttleInput = 0.45;
    this.handbrake = false;
    this.nitroActive = false;
  }

  private updateWrongWay() {
    const trackInfo = this.trackData.getClosestTrackInfo(this.position);
    const dot = this.forward.dot(trackInfo.tangent);
    this.isWrongWay = dot < -0.3 && Math.abs(this.speed) > 3;
  }

  public resetToNearestTrackPoint() {
    const trackInfo = this.trackData.getClosestTrackInfo(this.position);
    this.resetToTrack(trackInfo.t, 0);
  }
}
