import * as THREE from 'three';
import { CarModel, CarColorConfig } from './CarModel';
import { TrackData } from '../track/TrackData';

export abstract class CarBase {
  public model: CarModel;
  public group: THREE.Group;
  public trackData: TrackData;

  // Transform / Kinematics
  public position: THREE.Vector3 = new THREE.Vector3();
  public forward: THREE.Vector3 = new THREE.Vector3(0, 0, -1);
  public up: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
  public right: THREE.Vector3 = new THREE.Vector3(1, 0, 0);
  public yaw: number = 0; // heading angle in radians around Y

  // Motion dynamics
  public speed: number = 0; // forward speed in m/s (positive = forward, negative = reverse)
  public lateralVelocity: number = 0; // drift slip speed
  public steeringInput: number = 0; // -1 to 1
  public throttleInput: number = 0; // -1 to 1
  public handbrake: boolean = false;

  // Vehicle Parameters (Arcade tuned)
  public maxSpeedRoad: number = 62.0; // ~223 km/h
  public maxSpeedGrass: number = 18.0; // ~65 km/h
  public maxReverseSpeed: number = -14.0;
  public accelerationRate: number = 32.0; // m/s^2
  public brakingRate: number = 48.0;
  public naturalDecel: number = 10.0;
  public overSpeedBleed: number = 9.0; // m/s^2 ease-off above the surface limit
  public turnSpeed: number = 2.4; // max turn rate in rad/s

  // State flags
  public isOnRoad: boolean = true;
  public isDrifting: boolean = false;
  public currentTrackT: number = 0;
  public lateralOffset: number = 0;
  public collisionRadius: number = 1.8;

  // Nitro boost (arcade)
  public nitroAmount: number = 100; // 0..100
  // Set by the controller as intent; physics resolves it into actual boost.
  public nitroActive: boolean = false;
  // Latched when the tank runs dry; recharge past 30 to unlock.
  public nitroLocked: boolean = false;
  public nitroBoostPower: number = 22.0; // extra m/s top speed while boosting
  public nitroAccelBonus: number = 26.0; // extra m/s^2 while boosting
  // 0..1 impact this frame, read by the game for shake/sparks/sfx.
  public lastImpact: number = 0;

  // Lap / Progress tracking
  public currentLap: number = 1;
  public currentCheckpoint: number = 0;
  public raceProgress: number = 0; // lap * 1.0 + t
  public isFinished: boolean = false;
  public finishTime: number = 0;

  constructor(trackData: TrackData, colorConfig: CarColorConfig) {
    this.trackData = trackData;
    this.model = new CarModel(colorConfig);
    this.group = new THREE.Group();
    this.group.add(this.model.mesh);
  }

  // Swap the visual model (livery change) without touching physics state.
  protected replaceModel(config: CarColorConfig) {
    this.group.remove(this.model.mesh);
    this.model.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    this.model = new CarModel(config);
    this.group.add(this.model.mesh);
  }

  public resetToTrack(t: number, lateralOffset: number = 0) {
    const info = this.trackData.getPointInfoAt(t);
    this.currentTrackT = t;
    this.position.copy(info.position).addScaledVector(info.binormal, lateralOffset);
    this.position.y += 0.1;

    // Align yaw to track tangent
    this.yaw = Math.atan2(info.tangent.x, info.tangent.z) + Math.PI;
    this.speed = 0;
    this.lateralVelocity = 0;
    this.nitroAmount = Math.max(this.nitroAmount, 50);
    this.nitroActive = false;
    this.nitroLocked = false;
    this.lastImpact = 0;
    this.updateVectors();

    this.group.position.copy(this.position);
    this.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
  }

  protected updateVectors() {
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    // Note: (fz, 0, -fx) is the left vector; right is (-fz, 0, fx).
    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
  }

  public updatePhysics(delta: number) {
    this.lastImpact = Math.max(0, this.lastImpact - delta * 3.0);

    const trackInfo = this.trackData.getClosestTrackInfo(this.position, this.currentTrackT);
    this.currentTrackT = trackInfo.t;
    this.lateralOffset = trackInfo.lateralOffset;
    this.isOnRoad = trackInfo.isOnRoad;

    // Nitro intent comes from the controller each frame. A drained tank only
    // unlocks after the button is released and it recharges past 30.
    const requestingNitro = this.nitroActive;
    const hasThrottle = this.throttleInput > 0;
    if (requestingNitro && hasThrottle) {
      if (!this.nitroLocked && this.nitroAmount > 0) {
        this.nitroAmount = Math.max(0, this.nitroAmount - 34 * delta);
        this.nitroActive = true;
        if (this.nitroAmount <= 0) {
          this.nitroActive = false;
          this.nitroLocked = true;
        }
      } else {
        this.nitroActive = false;
      }
    } else {
      this.nitroActive = false;
      const regen = this.isDrifting ? 9.0 : 6.0;
      this.nitroAmount = Math.min(100, this.nitroAmount + regen * delta);
      if (this.nitroLocked && this.nitroAmount >= 30) {
        this.nitroLocked = false;
      }
    }
    const boosting = this.nitroActive && this.nitroAmount > 0;

    // Grass speed limit and drag penalty
    let effectiveMaxSpeed = this.isOnRoad ? this.maxSpeedRoad : this.maxSpeedGrass;
    let accelMultiplier = this.isOnRoad ? 1.0 : 0.45;
    if (boosting) {
      effectiveMaxSpeed += this.nitroBoostPower;
      accelMultiplier += 0.9;
    }

    // Acceleration & braking
    if (this.throttleInput > 0) {
      if (this.speed < effectiveMaxSpeed) {
        const bonus = boosting ? this.nitroAccelBonus : 0;
        this.speed += (this.accelerationRate * accelMultiplier * this.throttleInput + bonus) * delta;
      }
    } else if (this.throttleInput < 0) {
      if (this.speed > 0.5) {
        this.speed -= this.brakingRate * Math.abs(this.throttleInput) * delta;
      } else {
        if (this.speed > this.maxReverseSpeed) {
          this.speed -= this.accelerationRate * 0.5 * Math.abs(this.throttleInput) * delta;
        }
      }
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - this.naturalDecel * delta);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + this.naturalDecel * delta);
      }
    }

    // Handbrake: sharp drag + slide
    this.isDrifting = this.handbrake && Math.abs(this.speed) > 10;
    if (this.handbrake) {
      this.speed = Math.max(0, this.speed - this.brakingRate * 0.7 * delta);
    }

    // Ease back toward the surface limit when over it (spent nitro, grass entry).
    if (this.speed > effectiveMaxSpeed) {
      const bleedRate = this.isOnRoad ? this.overSpeedBleed : this.overSpeedBleed * 2.5;
      this.speed = Math.max(effectiveMaxSpeed, this.speed - bleedRate * delta);
    }

    // Less steering authority at speed to avoid spin-outs.
    const speedRatio = THREE.MathUtils.clamp(Math.abs(this.speed) / this.maxSpeedRoad, 0, 1);
    const speedSensitivity = THREE.MathUtils.lerp(1.0, 0.52, speedRatio);
    const driftSteerBoost = this.isDrifting ? 1.4 : 1.0;

    // Apply steering only when moving
    if (Math.abs(this.speed) > 0.1) {
      const dirSign = this.speed >= 0 ? 1 : -1;
      const effectiveTurn = this.turnSpeed * speedSensitivity * driftSteerBoost * this.steeringInput * dirSign;
      this.yaw += effectiveTurn * delta;
    }

    this.updateVectors();

    const lateralGrip = this.isDrifting ? 4.0 : 18.0;
    this.lateralVelocity = THREE.MathUtils.damp(this.lateralVelocity, 0, lateralGrip, delta);

    if (this.isDrifting) {
      this.lateralVelocity += -this.steeringInput * Math.abs(this.speed) * 0.45 * delta;
    }

    const moveStep = new THREE.Vector3()
      .copy(this.forward)
      .multiplyScalar(this.speed * delta)
      .addScaledVector(this.right, this.lateralVelocity * delta);

    this.position.add(moveStep);

    const targetY = trackInfo.trackPoint.y + 0.15;
    this.position.y = THREE.MathUtils.damp(this.position.y, targetY, 14, delta);

    this.handleBarrierCollision(trackInfo, delta);

    this.group.position.copy(this.position);

    const pitch = -trackInfo.tangent.y * 0.8;
    const lateralG = (this.speed / this.maxSpeedRoad) * this.steeringInput * 0.08;
    const roll = this.isDrifting ? this.steeringInput * 0.12 : -lateralG;

    const euler = new THREE.Euler(pitch, this.yaw, roll, 'YXZ');
    this.group.quaternion.setFromEuler(euler);

    const steerVisualAngle = this.steeringInput * 0.45;
    this.model.updateVisuals(steerVisualAngle, this.speed, delta);
    this.model.setBrakeLight(this.throttleInput < -0.05 || this.handbrake);
    this.model.setNitroFlames(boosting);

    this.raceProgress = (this.currentLap - 1) + this.currentTrackT;
  }

  // Barrier contact & unstuck tracking
  public isCollidingBarrier: boolean = false;
  private barrierContactTime: number = 0;
  private stuckTimer: number = 0;

  // Slide along the guardrail instead of sticking to it. Re-queries the
  // track point after moving, since the frame-start query is stale on curves.
  private handleBarrierCollision(_staleInfo: any, delta: number) {
    const trackInfo = this.trackData.getClosestTrackInfo(this.position, this.currentTrackT);
    this.currentTrackT = trackInfo.t;
    this.lateralOffset = trackInfo.lateralOffset;

    // Clamp the car body (not just its center) inside the visual rails.
    const maxDist = this.trackData.barrierDistance - 1.6;
    const currentOffset = trackInfo.lateralOffset;

    if (Math.abs(currentOffset) > maxDist) {
      const overstep = Math.abs(currentOffset) - maxDist;
      const pushSign = currentOffset > 0 ? -1 : 1;

      this.position.addScaledVector(trackInfo.binormal, pushSign * (overstep + 0.25));

      const tangentSpeed = this.forward.dot(trackInfo.tangent) * this.speed;
      const impactSpeed = Math.abs(this.speed);

      if (!this.isCollidingBarrier) {
        this.speed *= 0.88;
        this.isCollidingBarrier = true;
        this.lastImpact = Math.max(this.lastImpact, THREE.MathUtils.clamp(impactSpeed / 40, 0.25, 1));
      } else {
        this.speed = Math.max(tangentSpeed * 0.98, this.speed * 0.98);
      }

      this.lateralVelocity = pushSign * 1.5;

      const forwardDot = this.forward.dot(trackInfo.tangent);
      if (forwardDot < 0.6) {
        const targetYaw = Math.atan2(trackInfo.tangent.x, trackInfo.tangent.z) + Math.PI;
        this.yaw = THREE.MathUtils.lerp(this.yaw, targetYaw, 6.0 * delta);
        this.updateVectors();
      }

      if (Math.abs(this.speed) < 2.0) {
        this.stuckTimer += delta;
        if (this.stuckTimer > 2.5) {
          this.resetToTrack(trackInfo.t, 0);
          this.speed = 8.0;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
      }
    } else {
      this.isCollidingBarrier = false;
      this.stuckTimer = 0;
    }
  }

  public getSpeedKmH(): number {
    return Math.max(0, Math.round(this.speed * 3.6));
  }
}
