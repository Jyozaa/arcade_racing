import * as THREE from 'three';
import { TrackData } from './TrackData';

export class TrackMesh {
  public group: THREE.Group;
  private trackData: TrackData;
  private railColor: number;
  private gantryLightMats: THREE.MeshStandardMaterial[] = [];

  constructor(trackData: TrackData, railColor: number = 0x2563eb) {
    this.trackData = trackData;
    this.railColor = railColor;
    this.group = new THREE.Group();
    this.buildRoad();
    this.buildCurbs();
    this.buildGuardrails();
    this.buildFlyoverSupports();
    this.buildStartGantry();
  }

  public dispose() {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
    this.group.clear();
  }

  private buildRoad() {
    const segments = 600;
    const halfWidth = this.trackData.roadWidth / 2;

    const roadVerts: number[] = [];
    const roadNormals: number[] = [];
    const roadUvs: number[] = [];
    const roadIndices: number[] = [];

    const lineVerts: number[] = [];
    const lineIndices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const info = this.trackData.getPointInfoAt(t);

      const leftPt = new THREE.Vector3().copy(info.position).addScaledVector(info.binormal, -halfWidth);
      const rightPt = new THREE.Vector3().copy(info.position).addScaledVector(info.binormal, halfWidth);

      const yOffset = new THREE.Vector3().copy(info.normal).multiplyScalar(0.08);
      leftPt.add(yOffset);
      rightPt.add(yOffset);

      roadVerts.push(leftPt.x, leftPt.y, leftPt.z);
      roadVerts.push(rightPt.x, rightPt.y, rightPt.z);

      roadNormals.push(info.normal.x, info.normal.y, info.normal.z);
      roadNormals.push(info.normal.x, info.normal.y, info.normal.z);

      const uCoord = (i / segments) * 60; // texture repetition
      roadUvs.push(0, uCoord);
      roadUvs.push(1, uCoord);

      if (i < segments) {
        const base = i * 2;
        roadIndices.push(base, base + 1, base + 2);
        roadIndices.push(base + 1, base + 3, base + 2);
      }

      if (i % 4 < 2) {
        const lineOffset = 0.25;
        const cLeft = new THREE.Vector3().copy(info.position).addScaledVector(info.binormal, -lineOffset).add(yOffset).addScaledVector(info.normal, 0.02);
        const cRight = new THREE.Vector3().copy(info.position).addScaledVector(info.binormal, lineOffset).add(yOffset).addScaledVector(info.normal, 0.02);

        const lBase = (lineVerts.length / 3);
        lineVerts.push(cLeft.x, cLeft.y, cLeft.z);
        lineVerts.push(cRight.x, cRight.y, cRight.z);

        if (i % 4 === 1 && lineVerts.length >= 12) {
          lineIndices.push(lBase - 2, lBase - 1, lBase);
          lineIndices.push(lBase - 1, lBase + 1, lBase);
        }
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x22262c,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: false,
    });

    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    if (lineIndices.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
      lineGeo.setIndex(lineIndices);
      lineGeo.computeVertexNormals();

      const lineMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide
      });
      const lineMesh = new THREE.Mesh(lineGeo, lineMat);
      this.group.add(lineMesh);
    }

    this.buildStartFinishLine();
  }

  private buildStartFinishLine() {
    const info = this.trackData.getPointInfoAt(0);
    const halfWidth = this.trackData.roadWidth / 2;
    const g = new THREE.Group();

    const checkers = 14;
    const stripeWidth = (this.trackData.roadWidth) / checkers;
    const stripeLength = 4.0;

    for (let c = 0; c < checkers; c++) {
      for (let r = 0; r < 2; r++) {
        const isWhite = (c + r) % 2 === 0;
        const boxGeo = new THREE.PlaneGeometry(stripeWidth * 0.96, stripeLength * 0.48);
        const boxMat = new THREE.MeshBasicMaterial({
          color: isWhite ? 0xffffff : 0x111111,
          side: THREE.DoubleSide
        });
        const tile = new THREE.Mesh(boxGeo, boxMat);
        tile.rotation.x = -Math.PI / 2;

        const xOffset = -halfWidth + (c + 0.5) * stripeWidth;
        const zOffset = (r - 0.5) * (stripeLength * 0.5);

        tile.position.set(xOffset, 0.12, zOffset);
        g.add(tile);
      }
    }

    g.position.copy(info.position);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), info.tangent);
    this.group.add(g);
  }

  private buildCurbs() {
    const segments = 400;
    const halfRoad = this.trackData.roadWidth / 2;
    const curbW = this.trackData.curbWidth;

    const redVerts: number[] = [];
    const redIndices: number[] = [];
    const whiteVerts: number[] = [];
    const whiteIndices: number[] = [];

    for (let i = 0; i < segments; i++) {
      const isRed = Math.floor(i / 2) % 2 === 0;
      const t1 = i / segments;
      const t2 = (i + 1) / segments;

      const info1 = this.trackData.getPointInfoAt(t1);
      const info2 = this.trackData.getPointInfoAt(t2);

      this.addCurbSegment(
        info1, info2,
        -halfRoad - curbW, -halfRoad,
        isRed ? redVerts : whiteVerts,
        isRed ? redIndices : whiteIndices
      );

      this.addCurbSegment(
        info1, info2,
        halfRoad, halfRoad + curbW,
        isRed ? redVerts : whiteVerts,
        isRed ? redIndices : whiteIndices
      );
    }

    const redGeo = new THREE.BufferGeometry();
    redGeo.setAttribute('position', new THREE.Float32BufferAttribute(redVerts, 3));
    redGeo.setIndex(redIndices);
    redGeo.computeVertexNormals();

    const whiteGeo = new THREE.BufferGeometry();
    whiteGeo.setAttribute('position', new THREE.Float32BufferAttribute(whiteVerts, 3));
    whiteGeo.setIndex(whiteIndices);
    whiteGeo.computeVertexNormals();

    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });

    const redMesh = new THREE.Mesh(redGeo, redMat);
    const whiteMesh = new THREE.Mesh(whiteGeo, whiteMat);
    redMesh.receiveShadow = true;
    whiteMesh.receiveShadow = true;

    this.group.add(redMesh);
    this.group.add(whiteMesh);
  }

  private addCurbSegment(
    info1: any, info2: any,
    wStart: number, wEnd: number,
    verts: number[], indices: number[]
  ) {
    const yOff = 0.14;
    const p1 = new THREE.Vector3().copy(info1.position).addScaledVector(info1.binormal, wStart).addScaledVector(info1.normal, yOff);
    const p2 = new THREE.Vector3().copy(info1.position).addScaledVector(info1.binormal, wEnd).addScaledVector(info1.normal, yOff);
    const p3 = new THREE.Vector3().copy(info2.position).addScaledVector(info2.binormal, wStart).addScaledVector(info2.normal, yOff);
    const p4 = new THREE.Vector3().copy(info2.position).addScaledVector(info2.binormal, wEnd).addScaledVector(info2.normal, yOff);

    const base = verts.length / 3;
    verts.push(p1.x, p1.y, p1.z);
    verts.push(p2.x, p2.y, p2.z);
    verts.push(p3.x, p3.y, p3.z);
    verts.push(p4.x, p4.y, p4.z);

    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  private buildGuardrails() {
    const segments = 460;
    const railDist = this.trackData.barrierDistance;
    const railHeights = [0.95, 0.45];

    const railMat = new THREE.MeshStandardMaterial({
      color: this.railColor,
      metalness: 0.6,
      roughness: 0.3
    });

    const postMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.4
    });

    const railGeo = new THREE.BoxGeometry(0.22, 0.22, 1); // unit length, scaled per-instance
    const railCount = segments * 2 * railHeights.length;
    const rails = new THREE.InstancedMesh(railGeo, railMat, railCount);
    rails.castShadow = true;

    const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6);
    const postEvery = 4;
    const postCount = Math.ceil(segments / postEvery) * 2;
    const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    posts.castShadow = true;

    const dummy = new THREE.Object3D();
    const zAxis = new THREE.Vector3(0, 0, 1);
    let railIdx = 0;
    let postIdx = 0;

    for (let i = 0; i < segments; i++) {
      const t1 = i / segments;
      const t2 = (i + 1) / segments;
      const info1 = this.trackData.getPointInfoAt(t1);
      const info2 = this.trackData.getPointInfoAt(t2);

      for (const h of railHeights) {
        const l1 = new THREE.Vector3().copy(info1.position).addScaledVector(info1.binormal, -railDist).addScaledVector(info1.normal, h);
        const l2 = new THREE.Vector3().copy(info2.position).addScaledVector(info2.binormal, -railDist).addScaledVector(info2.normal, h);
        this.setRailInstance(rails, dummy, zAxis, railIdx++, l1, l2);

        const r1 = new THREE.Vector3().copy(info1.position).addScaledVector(info1.binormal, railDist).addScaledVector(info1.normal, h);
        const r2 = new THREE.Vector3().copy(info2.position).addScaledVector(info2.binormal, railDist).addScaledVector(info2.normal, h);
        this.setRailInstance(rails, dummy, zAxis, railIdx++, r1, r2);
      }

      if (i % postEvery === 0) {
        dummy.position.copy(info1.position).addScaledVector(info1.binormal, -railDist).addScaledVector(info1.normal, 0.55);
        dummy.quaternion.identity();
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(postIdx++, dummy.matrix);

        dummy.position.copy(info1.position).addScaledVector(info1.binormal, railDist).addScaledVector(info1.normal, 0.55);
        dummy.updateMatrix();
        posts.setMatrixAt(postIdx++, dummy.matrix);
      }
    }
    rails.instanceMatrix.needsUpdate = true;
    posts.instanceMatrix.needsUpdate = true;
    this.group.add(rails);
    this.group.add(posts);
  }

  private setRailInstance(
    mesh: THREE.InstancedMesh, dummy: THREE.Object3D, zAxis: THREE.Vector3,
    idx: number, p1: THREE.Vector3, p2: THREE.Vector3,
  ) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = Math.max(0.1, dir.length()) + 0.55;
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    dummy.position.copy(mid);
    dummy.quaternion.setFromUnitVectors(zAxis, dir.normalize());
    dummy.scale.set(1, 1, len);
    dummy.updateMatrix();
    mesh.setMatrixAt(idx, dummy.matrix);
  }

  // Support pillars under elevated decks; skipped where a deck passes below.
  private buildFlyoverSupports() {
    const samples = 140;
    const deckT: number[] = [];
    for (let i = 0; i < samples; i++) {
      const info = this.trackData.getPointInfoAt(i / samples);
      if (info.position.y > 4.5 && !this.hasDeckBelow(info.position)) deckT.push(i / samples);
    }
    if (deckT.length === 0) return;

    const pillarGeo = new THREE.BoxGeometry(1.4, 1, 1.4); // unit height, scaled per instance
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.9 });
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, deckT.length);
    pillars.castShadow = true;
    pillars.receiveShadow = true;

    const dummy = new THREE.Object3D();
    deckT.forEach((t, i) => {
      const info = this.trackData.getPointInfoAt(t);
      const top = info.position.y - 0.2;
      const h = Math.max(1, top + 0.5);
      dummy.position.set(info.position.x, top - h / 2, info.position.z);
      dummy.quaternion.identity();
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      pillars.setMatrixAt(i, dummy.matrix);
    });
    pillars.instanceMatrix.needsUpdate = true;
    this.group.add(pillars);
  }

  private hasDeckBelow(deckPos: THREE.Vector3): boolean {
    const pts = this.trackData.samplePoints;
    for (let i = 0; i < pts.length; i += 4) {
      const p = pts[i];
      const dy = deckPos.y - p.y;
      if (dy < 2.5) continue; // same deck, not below
      const dx = deckPos.x - p.x;
      const dz = deckPos.z - p.z;
      if (dx * dx + dz * dz < 81) return true; // within 9 m horizontally
    }
    return false;
  }

  private buildStartGantry() {
    const info = this.trackData.getPointInfoAt(0);
    const gantry = new THREE.Group();

    const span = 34.0;
    const height = 7.5;

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
    const pillarGeo = new THREE.BoxGeometry(0.8, height, 0.8);

    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-span / 2, height / 2, 0);
    leftPillar.castShadow = true;
    gantry.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(span / 2, height / 2, 0);
    rightPillar.castShadow = true;
    gantry.add(rightPillar);

    const beamGeo = new THREE.BoxGeometry(span + 1.6, 1.2, 1.2);
    const beam = new THREE.Mesh(beamGeo, pillarMat);
    beam.position.set(0, height, 0);
    beam.castShadow = true;
    gantry.add(beam);

    const bannerGeo = new THREE.BoxGeometry(span - 2, 1.6, 0.2);
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xff2a4b,
      roughness: 0.3
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, height + 0.2, -0.4);
    gantry.add(banner);

    this.gantryLightMats = [];
    for (let l = -2; l <= 2; l++) {
      const lightGeo = new THREE.SphereGeometry(0.3, 16, 16);
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0x330011,
        emissive: 0xff0033,
        emissiveIntensity: 0.08,
        roughness: 0.2
      });
      this.gantryLightMats.push(lightMat);
      const lightMesh = new THREE.Mesh(lightGeo, lightMat);
      lightMesh.position.set(l * 1.5, height - 0.8, -0.4);
      gantry.add(lightMesh);
    }

    gantry.position.copy(info.position);
    gantry.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), info.tangent);
    this.group.add(gantry);
  }

  // stage 3/2/1 = reds lit, 0 = GO green, -1 = off.
  public setCountdownStage(stage: number) {
    if (this.gantryLightMats.length === 0) return;
    if (stage < 0) {
      for (const m of this.gantryLightMats) {
        m.color.setHex(0x330011);
        m.emissive.setHex(0xff0033);
        m.emissiveIntensity = 0.08;
      }
      return;
    }
    if (stage === 0) {
      for (const m of this.gantryLightMats) {
        m.color.setHex(0x003311);
        m.emissive.setHex(0x00ff66);
        m.emissiveIntensity = 1.6;
      }
      return;
    }
    const lit = Math.min(5, Math.max(0, 6 - stage * 2 + 1));
    const want = stage >= 3 ? 1 : stage === 2 ? 3 : 5;
    this.gantryLightMats.forEach((m, i) => {
      const on = i < want;
      void lit;
      m.color.setHex(on ? 0xff0033 : 0x330011);
      m.emissive.setHex(0xff0033);
      m.emissiveIntensity = on ? 2.0 : 0.08;
    });
  }
}
