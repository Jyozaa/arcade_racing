import * as THREE from 'three';
import { TrackDefinition, getTrackDef } from './tracks';

export interface TrackPointInfo {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  t: number;
}

export class TrackData {
  public curve: THREE.CatmullRomCurve3;
  public roadWidth: number = 18.0;
  public curbWidth: number = 2.0;
  public barrierDistance: number = 14.0; // from centerline
  public totalLength: number;
  public samplePoints: THREE.Vector3[] = [];
  public sampleCount: number = 800;
  public trackId: string = 'apex-gp';
  public displayName: string = 'Apex Grand Prix';

  public checkpointCount: number = 16;
  public checkpoints: { t: number; position: THREE.Vector3; normal: THREE.Vector3 }[] = [];

  constructor(defIdOrDef?: string | TrackDefinition) {
    const def: TrackDefinition = typeof defIdOrDef === 'string'
      ? getTrackDef(defIdOrDef)
      : (defIdOrDef ?? getTrackDef('apex-gp'));

    this.trackId = def.id;
    this.displayName = def.name;
    this.roadWidth = def.roadWidth;
    this.curbWidth = def.curbWidth;
    this.barrierDistance = def.barrierDistance;
    this.checkpointCount = def.checkpointCount;

    const rawControlPoints = def.controlPoints.map((p) => p.clone());

    this.curve = new THREE.CatmullRomCurve3(rawControlPoints, true, 'centripetal', 0.5);
    // Fine divisions keep arc-length lookups uniform on long circuits.
    this.curve.arcLengthDivisions = 1600;
    this.totalLength = this.curve.getLength();

    for (let i = 0; i <= this.sampleCount; i++) {
      const t = i / this.sampleCount;
      this.samplePoints.push(this.curve.getPointAt(t));
    }

    for (let i = 0; i < this.checkpointCount; i++) {
      const t = i / this.checkpointCount;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      this.checkpoints.push({
        t,
        position: pos,
        normal: tangent
      });
    }
  }

  public getPointInfoAt(t: number): TrackPointInfo {
    let wrappedT = t % 1.0;
    if (wrappedT < 0) wrappedT += 1.0;

    const position = this.curve.getPointAt(wrappedT);
    const tangent = this.curve.getTangentAt(wrappedT).normalize();

    const worldUp = new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

    return { position, tangent, normal, binormal, t: wrappedT };
  }

  // Closest point + signed lateral offset. hintT limits the coarse scan
  // to a window around the previous t (faster, no snapping across the map).
  public getClosestTrackInfo(queryPos: THREE.Vector3, hintT?: number): {
    t: number;
    trackPoint: THREE.Vector3;
    distanceToCenter: number;
    lateralOffset: number;
    tangent: THREE.Vector3;
    normal: THREE.Vector3;
    binormal: THREE.Vector3;
    isOnRoad: boolean;
    isOnTrackBounds: boolean;
  } {
    let minCoarseDistSq = Infinity;
    let closestIndex = 0;

    if (hintT !== undefined && Number.isFinite(hintT)) {
      const hintIndex = ((hintT % 1.0) + 1.0) % 1.0 * this.sampleCount;
      const radiusSamples = Math.ceil(60 / this.totalLength * this.sampleCount);
      for (let s = -radiusSamples; s <= radiusSamples; s++) {
        let i = Math.round(hintIndex) + s;
        i = ((i % this.sampleCount) + this.sampleCount) % this.sampleCount;
        const dSq = queryPos.distanceToSquared(this.samplePoints[i]);
        if (dSq < minCoarseDistSq) {
          minCoarseDistSq = dSq;
          closestIndex = i;
        }
      }
      // Fell outside the window: fall back to a full scan.
      if (minCoarseDistSq > 60 * 60) {
        minCoarseDistSq = Infinity;
        for (let i = 0; i < this.sampleCount; i++) {
          const dSq = queryPos.distanceToSquared(this.samplePoints[i]);
          if (dSq < minCoarseDistSq) {
            minCoarseDistSq = dSq;
            closestIndex = i;
          }
        }
      }
    } else {
      for (let i = 0; i < this.sampleCount; i++) {
        const dSq = queryPos.distanceToSquared(this.samplePoints[i]);
        if (dSq < minCoarseDistSq) {
          minCoarseDistSq = dSq;
          closestIndex = i;
        }
      }
    }

    const coarseT = closestIndex / this.sampleCount;
    let bestT = coarseT;
    let bestDistSq = minCoarseDistSq;
    let window = 1.5 / this.sampleCount;
    const tmp = new THREE.Vector3();
    for (let pass = 0; pass < 2; pass++) {
      const steps = 10;
      for (let s = -steps; s <= steps; s++) {
        let testT = (bestT + (s / steps) * window) % 1.0;
        if (testT < 0) testT += 1.0;
        const pt = this.curve.getPointAt(testT, tmp);
        const dSq = queryPos.distanceToSquared(pt);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestT = testT;
        }
      }
      window *= 0.5;
    }

    const info = this.getPointInfoAt(bestT);
    const toQuery = new THREE.Vector3().subVectors(queryPos, info.position);

    const lateralOffset = toQuery.dot(info.binormal);
    const distanceToCenter = Math.abs(lateralOffset);

    const isOnRoad = distanceToCenter <= (this.roadWidth / 2 + this.curbWidth);
    const isOnTrackBounds = distanceToCenter <= this.barrierDistance;

    return {
      t: bestT,
      trackPoint: info.position,
      distanceToCenter,
      lateralOffset,
      tangent: info.tangent,
      normal: info.normal,
      binormal: info.binormal,
      isOnRoad,
      isOnTrackBounds
    };
  }
}
