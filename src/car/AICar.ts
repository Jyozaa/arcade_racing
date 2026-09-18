import * as THREE from 'three';
import { CarBase } from './CarBase';
import { TrackData } from '../track/TrackData';
import { CarColorConfig } from './CarModel';
import { TireCompound } from './cars';

export interface AIPersonality {
  name: string;
  speedFactor: number;       // 0.88 to 1.02
  cornerAggression: number;  // 0.70 to 0.90
  laneOffset: number;        // preferred lateral position (-2.5 to +2.5, near center)
}

export class AICar extends CarBase {
  public personality: AIPersonality;
  public livery: CarColorConfig;
  public flag: string = '🏁';
  public compound: TireCompound = 'MEDIUM';
  private aiStuckTimer: number = 0;
  private lastT: number = -1;
  private noProgressTimer: number = 0;
  private smoothedTargetSpeed: number = 0;
  private smoothLookDistM: number = 0;
  private overtakeSide: number = 0; // committed pass side: -1 = left, 1 = right, 0 = none
  private overtakeTimer: number = 0; // hysteresis: hold the pass line this long after losing the target
  private overtakeBias: number = 0; // damped lateral offset applied for the overtake (meters)
  private avoidPush: number = 0; // smoothed lateral repulsion from nearby traffic (meters)
  private trafficSlow: number = 0; // smoothed 0..1 longitudinal lift for traffic ahead

  constructor(trackData: TrackData, colorConfig: any, personality: AIPersonality) {
    super(trackData, colorConfig);
    this.livery = colorConfig;
    this.personality = personality;
    this.maxSpeedRoad *= personality.speedFactor;
  }

  // Reset AI pursuit state for a new race.
  public resetRaceState() {
    this.aiStuckTimer = 0;
    this.lastT = -1;
    this.noProgressTimer = 0;
    this.smoothedTargetSpeed = 0;
    this.smoothLookDistM = 0;
    this.overtakeSide = 0;
    this.overtakeTimer = 0;
    this.overtakeBias = 0;
    this.avoidPush = 0;
    this.trafficSlow = 0;
    this.steeringInput = 0;
    this.throttleInput = 0;
    this.handbrake = false;
    this.finishTime = 0;
    this.raceProgress = 0;
    this.nitroAmount = 100;
    this.nitroActive = false;
    this.nitroLocked = false;
  }

  // Per-frame rubber-band offset from the race manager.
  public rubberBand: number = 0;

  // Swap paint without touching handling stats.
  public applyLivery(config: CarColorConfig) {
    this.replaceModel(config);
    this.livery = config;
    this.model.setFlagDecal(this.flag);
  }

  public setFlag(emoji: string) {
    this.flag = emoji;
    this.model.setFlagDecal(emoji);
  }

  public updateAI(delta: number, allCars: CarBase[]) {
    // Finished cars hold their line instead of passing.
    if (this.isFinished && (this.overtakeSide !== 0 || this.overtakeTimer > 0 || this.overtakeBias !== 0)) {
      this.overtakeSide = 0;
      this.overtakeTimer = 0;
      this.overtakeBias = 0;
    }
    const trackInfo = this.trackData.getClosestTrackInfo(this.position, this.currentTrackT);
    this.currentTrackT = trackInfo.t;
    const roadHalfWidth = this.trackData.roadWidth * 0.5;

    const effSpeed = Math.max(8.0, Math.abs(this.speed));
    const rawLookDistM = THREE.MathUtils.clamp(effSpeed * 1.4, 16, 60);
    if (this.smoothLookDistM === 0) this.smoothLookDistM = rawLookDistM;
    const lookAlpha = 1 - Math.exp(-8 * delta);
    this.smoothLookDistM = THREE.MathUtils.lerp(this.smoothLookDistM, rawLookDistM, lookAlpha);
    const lookAheadT = this.smoothLookDistM / this.trackData.totalLength;

    const tNear = (this.currentTrackT + lookAheadT * 0.5) % 1.0;
    const tFar  = (this.currentTrackT + lookAheadT)       % 1.0;

    const nearInfo = this.trackData.getPointInfoAt(tNear);
    const farInfo  = this.trackData.getPointInfoAt(tFar);

    const dotFwd    = THREE.MathUtils.clamp(trackInfo.tangent.dot(farInfo.tangent), -1, 1);
    const curvature = 1.0 - dotFwd;

    const significantCurve = Math.max(0, curvature - 0.07);

    const minCornerSpeed = 22.0; // m/s through the tightest hairpin
    const aggression     = THREE.MathUtils.clamp(this.personality.cornerAggression, 0.70, 0.98);
    const cornerBlend    = THREE.MathUtils.clamp(significantCurve * 3.5 * (1.3 - aggression), 0, 1);
    const rawTargetSpeed = THREE.MathUtils.lerp(this.maxSpeedRoad, minCornerSpeed, cornerBlend);
    if (this.smoothedTargetSpeed === 0) this.smoothedTargetSpeed = rawTargetSpeed;
    this.smoothedTargetSpeed = THREE.MathUtils.damp(this.smoothedTargetSpeed, rawTargetSpeed, 4.0, delta);
    const cornerTargetSpeed = this.smoothedTargetSpeed;

    const maxOffset = roadHalfWidth * 0.75;
    const safeHalf = Math.min(maxOffset, this.trackData.barrierDistance - 3.5);
    let targetOffset = THREE.MathUtils.clamp(this.personality.laneOffset, -safeHalf, safeHalf);
    const wallDist = safeHalf - Math.abs(trackInfo.lateralOffset);
    if (wallDist < 3.0) {
      const toCenter = trackInfo.lateralOffset > 0 ? -1 : 1;
      targetOffset += toCenter * (3.0 - wallDist) * 2.0;
    }
    // Steer back toward the center early when the current heading runs wide.
    const predDistM = Math.max(4, Math.abs(this.speed) * 0.6 + 4);
    const predPos = new THREE.Vector3().copy(this.position).addScaledVector(this.forward, predDistM);
    const predInfo = this.trackData.getClosestTrackInfo(predPos, this.currentTrackT);
    const predExcess = Math.abs(predInfo.lateralOffset) - (safeHalf - 1.0);
    if (predExcess > 0) {
      const toCenterPred = predInfo.lateralOffset > 0 ? -1 : 1;
      targetOffset += toCenterPred * predExcess * 1.5;
    }
    // Lift off when pointed at the fence while close to it.
    const outwardSign = trackInfo.lateralOffset > 0.1 ? 1 : trackInfo.lateralOffset < -0.1 ? -1 : 0;
    const wallHeading = outwardSign !== 0 ? this.forward.dot(trackInfo.binormal) * outwardSign : 0;
    let wallSlowFactor = 1;
    if (Math.abs(trackInfo.lateralOffset) > safeHalf - 2.0 && wallHeading > 0.2) {
      wallSlowFactor = 1 - Math.min(0.35, (wallHeading - 0.2) * 0.6);
    }
    if (predExcess > 0) {
      wallSlowFactor = Math.min(wallSlowFactor, 1 - Math.min(0.4, predExcess * 0.12));
    }
    targetOffset = THREE.MathUtils.clamp(targetOffset, -safeHalf, safeHalf);

    let overtakeTarget: CarBase | null = null;
    let bestOvertakeScore = Infinity;
    const wantsToOvertake = !this.isFinished;
    for (const other of allCars) {
      if (!wantsToOvertake) break;
      if (other === this || other.isFinished) continue;
      const toOther = new THREE.Vector3().subVectors(other.position, this.position);
      const dist = toOther.length();
      if (dist > 28 || dist < 0.5) continue;
      toOther.divideScalar(dist);
      const fwdDot = this.forward.dot(toOther);
      if (fwdDot < 0.55) continue; // not meaningfully ahead
      // Track-progress gap: how far ahead of us they are around the lap.
      let tGap = other.raceProgress - this.raceProgress;
      tGap -= Math.round(tGap); // wrap to [-0.5, 0.5]
      if (tGap < -0.02 || tGap > 0.06) continue;
      // Only chase targets we can catch (slower or side-by-side rate)
      if (other.speed > this.speed + 4) continue;
      if (dist < bestOvertakeScore) {
        bestOvertakeScore = dist;
        overtakeTarget = other;
      }
    }

    // Only pass on straights, never while fighting the fence.
    const straightEnough = significantCurve < 0.02;
    const fenceCalm = wallSlowFactor > 0.85;

    if (overtakeTarget && straightEnough && wantsToOvertake && fenceCalm) {
      const selfLat = trackInfo.lateralOffset;
      const targetInfo = this.trackData.getClosestTrackInfo(
        overtakeTarget.position, overtakeTarget.currentTrackT
      );
      const targetLat = targetInfo.lateralOffset;
      const sideNow = targetLat >= selfLat ? -1 : 1;
      if (this.overtakeSide === 0) {
        const roomLeft = selfLat + safeHalf;
        const roomRight = safeHalf - selfLat;
        this.overtakeSide = sideNow;
        if (sideNow === -1 && roomLeft < 3.5 && roomRight >= 3.5) this.overtakeSide = 1;
        if (sideNow === 1 && roomRight < 3.5 && roomLeft >= 3.5) this.overtakeSide = -1;
      }
      // Abort the pass when the destination line has no room.
      const destLine = THREE.MathUtils.clamp(
        targetLat + this.overtakeSide * 4.2,
        -safeHalf, safeHalf
      );
      let destBlocked = Math.abs(destLine) > safeHalf - 0.75;
      if (!destBlocked) {
        for (const other of allCars) {
          if (other === this || other === overtakeTarget) continue;
          const toO = new THREE.Vector3().subVectors(other.position, this.position);
          const gapD = toO.length();
          if (gapD >= 9 || gapD < 0.001) continue;
          if (this.forward.dot(toO.divideScalar(gapD)) < -0.3) continue;
          // Cars update sequentially so cached laterals can be a frame stale here.
          const blockerLat = this.trackData.getClosestTrackInfo(
            other.position, other.currentTrackT
          ).lateralOffset;
          if (Math.abs(blockerLat - destLine) < 3.5) { // ~collision diameter
            destBlocked = true;
            break;
          }
        }
      }
      if (destBlocked) {
        this.overtakeSide = 0;
        this.overtakeTimer = 0;
        this.overtakeBias = THREE.MathUtils.damp(this.overtakeBias, 0, 5.0, delta);
        overtakeTarget = null;
      } else {
        this.overtakeTimer = 1.2;
        const desiredBias = destLine - this.personality.laneOffset;
        this.overtakeBias = THREE.MathUtils.damp(this.overtakeBias, desiredBias, 3.5, delta);
      }
    }
    if (!overtakeTarget || !straightEnough || !wantsToOvertake || !fenceCalm) {
      if (this.overtakeTimer > 0) {
        this.overtakeTimer -= delta;
        if (this.overtakeTimer <= 0) {
          this.overtakeSide = 0;
        }
        this.overtakeBias = THREE.MathUtils.damp(this.overtakeBias, 0, 2.5, delta);
      } else {
        this.overtakeSide = 0;
        this.overtakeBias = THREE.MathUtils.damp(this.overtakeBias, 0, 5.0, delta);
      }
    }
    const overtakeOffset = THREE.MathUtils.clamp(
      targetOffset + this.overtakeBias, -safeHalf, safeHalf
    );

    let avoidDesired = 0;
    let trafficSlowDesired = 0;
    let carBlockingAhead = false;
    for (const other of allCars) {
      if (other === this) continue;
      const rel = new THREE.Vector3().subVectors(other.position, this.position);
      const dist = rel.length();
      if (dist > 18 || dist < 0.001) continue;
      rel.divideScalar(dist);
      const fwd = this.forward.dot(rel);
      // Rival laterals are cached (≤1 frame stale); fine at this scale.
      const lateralGap = other.lateralOffset - trackInfo.lateralOffset; // + = rival right
      const absGap = Math.abs(lateralGap);
      const gapSign = lateralGap > 0.05 ? 1 : lateralGap < -0.05 ? -1 : 0;

      // Emergency bubble: any direction, hard repulsion.
      if (dist < 4.5) {
        const pushSide = gapSign !== 0 ? -gapSign : (this.overtakeSide !== 0 ? this.overtakeSide : (trackInfo.lateralOffset >= 0 ? -1 : 1));
        avoidDesired += pushSide * (4.5 - dist) * 1.4;
        trafficSlowDesired = Math.max(trafficSlowDesired, fwd > 0.3 ? 0.75 : 0.35);
        if (fwd > 0.5 && dist < 6) carBlockingAhead = true;
        continue;
      }

      // Ahead corridor: rival on (or near) our line.
      if (fwd > 0.4 && dist < 14 && absGap < 3.0) {
        const pushSide = gapSign !== 0 ? -gapSign : (this.overtakeSide !== 0 ? this.overtakeSide : (trackInfo.lateralOffset >= 0 ? -1 : 1));
        avoidDesired += pushSide * (1 - dist / 14) * 2.6;
        const closing = this.speed - other.speed;
        if (closing > 1) {
          trafficSlowDesired = Math.max(trafficSlowDesired, Math.min(0.85, (1 - dist / 14) * (0.35 + closing * 0.08)));
        }
        if (fwd > 0.7 && dist < 9 && absGap < 2.5) carBlockingAhead = true;
        continue;
      }

      // Side-by-side: hold a 2.5 m slot.
      if (Math.abs(fwd) <= 0.4 && dist < 5.5 && absGap < 2.5) {
        if (gapSign !== 0) {
          avoidDesired += -gapSign * (2.5 - absGap) * 1.1;
        }
      }
    }
    avoidDesired = THREE.MathUtils.clamp(avoidDesired, -4.5, 4.5);
    trafficSlowDesired = THREE.MathUtils.clamp(trafficSlowDesired, 0, 1);
    this.avoidPush = THREE.MathUtils.damp(this.avoidPush, avoidDesired, 6.0, delta);
    this.trafficSlow = THREE.MathUtils.damp(this.trafficSlow, trafficSlowDesired, 5.0, delta);

    // Hold the corridor edge and lift instead of steering into the fence.
    const rawFinal = overtakeOffset + this.avoidPush;
    const clampedFinal = THREE.MathUtils.clamp(rawFinal, -safeHalf, safeHalf);
    let clampedLift = 0;
    if (Math.abs(rawFinal - clampedFinal) > 0.5) {
      clampedLift = 0.6;
    }
    const finalOffset = clampedFinal;

    const targetPos = new THREE.Vector3()
      .addScaledVector(nearInfo.position, 0.65)
      .addScaledVector(farInfo.position,  0.35)
      .addScaledVector(nearInfo.binormal, finalOffset);

    const toTarget = new THREE.Vector3().subVectors(targetPos, this.position);
    toTarget.y = 0;
    const len = toTarget.length();
    if (len > 0.01) toTarget.divideScalar(len);

    const cross     = this.forward.clone().cross(toTarget);
    const steerDir  = Math.sign(cross.y);
    const angle     = Math.acos(THREE.MathUtils.clamp(this.forward.dot(toTarget), -1, 1));
    const desiredSteer = THREE.MathUtils.clamp(steerDir * angle * 2.0, -1, 1);
    this.steeringInput = THREE.MathUtils.damp(this.steeringInput, desiredSteer, 10.0, delta);

    let finalTarget = cornerTargetSpeed * wallSlowFactor;
    finalTarget *= (1 - this.trafficSlow * 0.5);
    if (clampedLift > 0) finalTarget *= (1 - clampedLift * 0.4);
    finalTarget *= (1 + THREE.MathUtils.clamp(this.rubberBand, -0.07, 0.10));
    finalTarget = Math.max(8, finalTarget);
    const isOvertaking = this.overtakeTimer > 0 && straightEnough && wantsToOvertake && fenceCalm;
    const wantNitro = straightEnough && fenceCalm && !this.isFinished &&
      this.nitroAmount > 55 && this.speed > 20 && this.trafficSlow < 0.25;
    this.nitroActive = wantNitro;
    if (wantNitro) finalTarget += this.nitroBoostPower * 0.85;
    const speedOverTarget = this.speed - finalTarget;
    if (isOvertaking && speedOverTarget <= 5.0) {
      this.throttleInput = 1.0;
    } else if (carBlockingAhead && !isOvertaking) {
      if (this.trafficSlow > 0.55) {
        const brakeFraction = THREE.MathUtils.clamp(0.35 + this.trafficSlow * 0.5, 0.35, 0.8);
        this.throttleInput = -brakeFraction;
      } else if (this.speed > 18.0) {
        this.throttleInput = 0.3;
      } else {
        this.throttleInput = 0.0;
      }
    } else if (speedOverTarget > 5.0) {
      const brakeFraction = THREE.MathUtils.clamp(speedOverTarget / this.maxSpeedRoad * 3.5, 0.2, 0.60);
      this.throttleInput = -brakeFraction;
    } else if (speedOverTarget > 0) {
      this.throttleInput = 0.0;
    } else {
      this.throttleInput = THREE.MathUtils.clamp(1.0 - this.trafficSlow * 0.6, 0.25, 1.0);
    }

    this.handbrake = false;

    const fwdDot = this.forward.dot(trackInfo.tangent);
    if (fwdDot < -0.25) {
      this.aiStuckTimer += delta;
    } else {
      this.aiStuckTimer = Math.max(0, this.aiStuckTimer - delta * 0.5);
    }

    // No-progress recovery (covers stuck-on-barrier too).
    if (this.lastT < 0) this.lastT = this.currentTrackT;
    let tDelta = this.currentTrackT - this.lastT;
    if (tDelta < -0.5) tDelta += 1.0; // wrap-around
    if (tDelta >= 0.0008) {
      this.noProgressTimer = 0;
      this.lastT = this.currentTrackT;
    } else {
      this.noProgressTimer += delta;
    }

    if (this.aiStuckTimer > 1.5 || this.noProgressTimer > 4.5) {
      this.resetToTrack(this.currentTrackT, this.personality.laneOffset * 0.3);
      this.speed = 16.0;
      this.aiStuckTimer = 0;
      this.noProgressTimer = 0;
      this.lastT = this.currentTrackT;
      this.overtakeSide = 0;
      this.overtakeTimer = 0;
      this.overtakeBias = 0;
      this.avoidPush = 0;
      this.trafficSlow = 0;
      return;
    }

    this.updatePhysics(delta);
  }
}
