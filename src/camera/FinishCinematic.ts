import * as THREE from 'three';
import { PlayerCar } from '../car/PlayerCar';
import { TrackData } from '../track/TrackData';

/**
 * FinishCinematic — the 3-shot end-of-race sequence for AI Race.
 *
 *   SHOT 1 (~2.0s)  low front/side tracking shot, camera glides with the car
 *   SHOT 2 (~2.0s)  static trackside camera, the car blasts past at speed
 *   SHOT 3 (~2.5s)  low rear three-quarter hero shot, car drives into the scene
 *                   -> existing results UI
 *
 * The car keeps rolling under a gentle autopilot (player input is locked),
 * and the camera observes it — the car is never teleported. Each shot is a
 * rigid camera formation (zero follow lag by construction); transitions use
 * a short explicit ease between the previous frame and the new shot, so the
 * sequence reads as three distinct shots joined by smooth blends — no hard
 * cuts, no screen fades. All motion is delta-time driven and
 * framerate-independent.
 *
 * Safety: every camera position is clamped above the track, inside a
 * corridor around the spline, outside the car body, and within a sane range
 * of the car, so the camera can never dive underground, into mountains, or
 * lose the car behind terrain. A minimum look distance guards the lookAt
 * against ever degenerating.
 */
export const FINISH_SHOT_DURATIONS = [2.0, 2.0, 2.5] as const;
export const FINISH_CINEMATIC_DURATION =
  FINISH_SHOT_DURATIONS[0] + FINISH_SHOT_DURATIONS[1] + FINISH_SHOT_DURATIONS[2];

const MIN_CAM_HEIGHT_ABOVE_CAR = 1.4;
const ABSOLUTE_MIN_CAM_Y = 1.0;
const MAX_CAM_DIST_FROM_CAR = 45;
const MIN_CAM_DIST_FROM_CAR = 2.4;
const MAX_CAM_DIST_FROM_TRACK = 26;

// Blend duration between shots: the new shot eases in over this long,
// then holds rigidly. Short enough to feel like cuts, long enough to glide.
const SHOT_BLEND = 0.5;

// Minimum look-at distance: keeps the lookAt from ever degenerating when the
// blend path passes near the camera during shot transitions.
const MIN_LOOK_DIST = 2.0;

interface ShotAnchor {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class FinishCinematic {
  public isActive: boolean = false;

  private elapsed: number = 0;
  private shotIndex: number = -1;
  private skipRequested: boolean = false;

  // Displayed frame, plus the blend source snapshot at each shot entry.
  private shownPos: THREE.Vector3 = new THREE.Vector3();
  private shownLook: THREE.Vector3 = new THREE.Vector3();
  private shownFov: number = 60;
  private blendFromPos: THREE.Vector3 = new THREE.Vector3();
  private blendFromLook: THREE.Vector3 = new THREE.Vector3();
  private blendFromFov: number = 60;

  // Shot 2's fixed trackside anchor, picked when the shot starts. The look
  // tracks the car through the pass, then freezes just after it goes by:
  // the static camera keeps staring down-track while the car pulls away
  // and out of frame, like a locked-off broadcast camera.
  private tracksidePos: THREE.Vector3 = new THREE.Vector3();
  private lookFrozen: boolean = false;

  private tmpA: THREE.Vector3 = new THREE.Vector3();
  private tmpB: THREE.Vector3 = new THREE.Vector3();
  private desired: ShotAnchor = {
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    fov: 60,
  };

  /** Begin the sequence. Seeds the blend from the live camera: no hard cut. */
  public start(player: PlayerCar, camera: THREE.PerspectiveCamera): void {
    this.isActive = true;
    this.elapsed = 0;
    this.shotIndex = -1;
    this.skipRequested = false;
    this.lookFrozen = false;
    this.shownPos.copy(camera.position);
    this.shownLook.copy(player.position).add(this.tmpA.set(0, 1.2, 0));
    this.shownFov = camera.fov;
    this.blendFromPos.copy(this.shownPos);
    this.blendFromLook.copy(this.shownLook);
    this.blendFromFov = this.shownFov;
    player.inputLocked = true;
    player.cinematicAuto = true;
  }
  public requestSkip(): void {
    this.skipRequested = true;
  }

  /** Stop early (skip / menu / restart). Restores normal control. */
  public stop(player: PlayerCar): void {
    this.isActive = false;
    player.inputLocked = false;
    player.cinematicAuto = false;
  }

  /** Current shot 0..2, derived from elapsed time. */
  public get activeShot(): number {
    return shotIndexForTime(this.elapsed);
  }

  /**
   * Advance the cinematic and drive the camera. Returns true when the
   * sequence is complete (or skipped) and the game should show results.
   */
  public update(
    camera: THREE.PerspectiveCamera,
    player: PlayerCar,
    trackData: TrackData,
    delta: number,
  ): boolean {
    if (!this.isActive) return true;
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.elapsed += dt;

    if (this.skipRequested || this.elapsed >= FINISH_CINEMATIC_DURATION) {
      return true;
    }

    const shot = shotIndexForTime(this.elapsed);
    if (shot !== this.shotIndex) {
      // Shot entry: snapshot the current frame as the blend source.
      this.blendFromPos.copy(this.shownPos);
      this.blendFromLook.copy(this.shownLook);
      this.blendFromFov = this.shownFov;
      this.shotIndex = shot;
      this.lookFrozen = false;
      if (shot === 1) this.pickTracksideAnchor(player, trackData);
    }
    const shotTime = this.elapsed - shotStartTime(shot);

    this.computeDesired(shot, shotTime, player, trackData);

    // Explicit blend: ease from the previous shot's last frame to this
    // shot's rigid formation over SHOT_BLEND, then hold the shot exactly.
    const b = THREE.MathUtils.smootherstep(Math.min(1, shotTime / SHOT_BLEND), 0, 1);
    this.shownPos.copy(this.blendFromPos).lerp(this.desired.pos, b);
    this.shownLook.copy(this.blendFromLook).lerp(this.desired.look, b);
    this.shownFov = THREE.MathUtils.lerp(this.blendFromFov, this.desired.fov, b);

    // Clamp the final transform, so the blend path itself can't dip
    // underground or inside the car between shots.
    this.clampCamera(this.shownPos, player, trackData);

    // Degeneracy guard: the look target must never sit on the lens.
    this.tmpA.subVectors(this.shownLook, this.shownPos);
    if (this.tmpA.length() < MIN_LOOK_DIST) {
      if (this.tmpA.lengthSq() < 1e-8) this.tmpA.copy(player.forward);
      this.tmpA.normalize();
      this.shownLook.copy(this.shownPos).addScaledVector(this.tmpA, MIN_LOOK_DIST);
    }

    camera.position.copy(this.shownPos);
    camera.lookAt(this.shownLook);
    camera.fov = this.shownFov;
    camera.updateProjectionMatrix();
    return false;
  }

  // -- Shots ------------------------------------------------------------------
  private computeDesired(
    shot: number,
    shotTime: number,
    player: PlayerCar,
    trackData: TrackData,
  ): void {
    const carPos = player.position;
    const fwd = player.forward;
    const right = player.right;
    const d = this.desired;

    if (shot === 0) {
      // SHOT 1 — low side tracking shot drifting toward the front/side,
      // with a gentle sway. Starts near a pure side view so the opening
      // blend from the rear chase camera stays a short, graceful swing.
      const e = THREE.MathUtils.smoothstep(shotTime / FINISH_SHOT_DURATIONS[0], 0, 1);
      const sway = Math.sin(shotTime * 1.4) * 0.5;
      const bob = Math.sin(shotTime * 2.2) * 0.15;
      d.pos
        .copy(carPos)
        .addScaledVector(fwd, THREE.MathUtils.lerp(0.5, 6.0, e))
        .addScaledVector(right, THREE.MathUtils.lerp(6.5, 4.2, e) + sway)
        .add(this.tmpA.set(0, 1.7 + bob, 0));
      d.look.copy(carPos).addScaledVector(fwd, 1.5).add(this.tmpA.set(0, 1.1, 0));
      d.fov = 62;
    } else if (shot === 1) {
      // SHOT 2 — fixed trackside camera. The look tracks the car in and
      // through the pass, then freezes once the car is just past the lens:
      // the camera holds down-track while the car pulls away and exits.
      this.tmpB.subVectors(carPos, this.tracksidePos);
      const distToCar = this.tmpB.length();
      const longitudinal = this.tmpB.dot(player.forward);
      if (!this.lookFrozen && shotTime > 0.2 && longitudinal > 4 && distToCar < 30) {
        this.lookFrozen = true;
      }
      d.pos.copy(this.tracksidePos);
      if (this.lookFrozen) {
        d.look.copy(this.shownLook);
      } else {
        d.look.copy(carPos).add(this.tmpA.set(0, 1.1, 0));
      }
      d.fov = THREE.MathUtils.lerp(56, 66, shotTime / FINISH_SHOT_DURATIONS[1]);
    } else {
      // SHOT 3 — low rear three-quarter hero shot, slowly pulling back/up.
      const t = shotTime / FINISH_SHOT_DURATIONS[2];
      const drift = Math.sin(shotTime * 0.9) * 0.4;
      d.pos
        .copy(carPos)
        .addScaledVector(fwd, -(7.5 + t * 2.2))
        .addScaledVector(right, 3.4 + drift)
        .add(this.tmpA.set(0, 2.1 + t * 1.3, 0));
      d.look.copy(carPos).addScaledVector(fwd, 5.0).add(this.tmpA.set(0, 1.3, 0));
      d.fov = THREE.MathUtils.lerp(58, 64, t);
    }

    this.clampCamera(d.pos, player, trackData);
  }

  /** Pick a trackside spot ahead of the car so it drives past the lens. */
  private pickTracksideAnchor(player: PlayerCar, trackData: TrackData): void {
    const speed = Math.abs(player.speed);
    const aheadDist = THREE.MathUtils.clamp(speed * 1.1 + 16, 20, 60);
    const aheadT = player.currentTrackT + aheadDist / Math.max(1, trackData.totalLength);
    const info = trackData.getPointInfoAt(aheadT);

    // Camera on the opposite side from the car's current offset keeps the
    // racing line between lens and car for a clean pass-by.
    const side = player.lateralOffset >= 0 ? -1 : 1;
    this.tracksidePos
      .copy(info.position)
      .addScaledVector(info.binormal, side * 10.5)
      .add(this.tmpA.set(0, 2.4, 0));

    this.clampCamera(this.tracksidePos, player, trackData);
  }

  /**
   * Hard safety constraints for any camera position: above the track,
   * inside a corridor around the spline, outside the car, near the action.
   */
  private clampCamera(out: THREE.Vector3, player: PlayerCar, trackData: TrackData): void {
    // 1. Never underground: the infield near the track is flat (~-0.2), and
    //    the car itself sits on the road surface, so car height is the ref.
    const minY = Math.max(player.position.y + MIN_CAM_HEIGHT_ABOVE_CAR, ABSOLUTE_MIN_CAM_Y);
    if (out.y < minY) out.y = minY;

    // 2. Stay near the circuit corridor so mountains/terrain can't swallow
    //    the camera or block the view of the car.
    const info = trackData.getClosestTrackInfo(out, player.currentTrackT);
    if (info.distanceToCenter > MAX_CAM_DIST_FROM_TRACK) {
      const excess = info.distanceToCenter - MAX_CAM_DIST_FROM_TRACK;
      this.tmpB.copy(out).sub(info.trackPoint).setY(0);
      if (this.tmpB.lengthSq() > 1e-6) {
        this.tmpB.normalize();
        out.addScaledVector(this.tmpB, -excess);
      } else {
        out.copy(info.trackPoint).add(this.tmpA.set(0, 3, 0));
      }
      if (out.y < minY) out.y = minY;
    }

    // 3. Never inside the player's car.
    this.tmpB.copy(out).sub(player.position);
    const distToCar = this.tmpB.length();
    if (distToCar < MIN_CAM_DIST_FROM_CAR) {
      if (distToCar > 1e-4) {
        this.tmpB.multiplyScalar(1 / distToCar);
      } else {
        this.tmpB.copy(player.right);
      }
      out.copy(player.position).addScaledVector(this.tmpB, MIN_CAM_DIST_FROM_CAR);
      if (out.y < minY) out.y = minY;
    }

    // 4. Never stranded far from the action.
    this.tmpB.copy(out).sub(player.position);
    const far = this.tmpB.length();
    if (far > MAX_CAM_DIST_FROM_CAR) {
      this.tmpB.multiplyScalar(MAX_CAM_DIST_FROM_CAR / far);
      out.copy(player.position).add(this.tmpB);
      if (out.y < minY) out.y = minY;
    }
  }
}

export function shotStartTime(shot: number): number {
  let t = 0;
  for (let i = 0; i < shot; i++) t += FINISH_SHOT_DURATIONS[i];
  return t;
}

export function shotIndexForTime(elapsed: number): number {
  let acc = 0;
  for (let i = 0; i < FINISH_SHOT_DURATIONS.length; i++) {
    acc += FINISH_SHOT_DURATIONS[i];
    if (elapsed < acc) return i;
  }
  return FINISH_SHOT_DURATIONS.length - 1;
}
