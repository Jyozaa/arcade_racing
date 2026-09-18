import * as THREE from 'three';
import { TrackData } from './TrackData';
import { TrackAtmosphere } from './tracks';

export class Environment {
  public group: THREE.Group;
  private clouds: THREE.Group[] = [];
  private palette: TrackAtmosphere | null;

  constructor(trackData: TrackData, atmosphere?: TrackAtmosphere) {
    this.group = new THREE.Group();
    this.palette = atmosphere ?? null;
    this.buildTerrain(trackData);
    this.buildMountains(trackData);
    this.buildTrees(trackData);
    this.buildClouds();
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
    this.clouds = [];
  }

  private buildTerrain(trackData: TrackData) {
    const terrainGeo = new THREE.PlaneGeometry(1800, 1800, 64, 64);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    const tempVec = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      tempVec.set(x, 0, z);

      const info = trackData.getClosestTrackInfo(tempVec);
      const distToTrack = tempVec.distanceTo(info.trackPoint);

      // Flat near the track, hills beyond.
      if (distToTrack < 75) {
        pos.setY(i, -0.2);
      } else {
        const corridorBlend = THREE.MathUtils.clamp((distToTrack - 75) / 60, 0, 1);
        const hillHeight = (Math.sin(x * 0.008) * Math.cos(z * 0.008) * 22 + Math.sin(x * 0.02 + z * 0.015) * 8) * corridorBlend;
        pos.setY(i, Math.max(-0.2, hillHeight - 0.2));
      }
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: this.palette?.terrainColor ?? 0x4ade80,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = true;
    this.group.add(terrain);
  }

  private buildMountains(trackData: TrackData) {
    const mountainColors = this.palette?.mountainColors ?? [0x3b82f6, 0x60a5fa, 0x93c5fd, 0x2563eb];
    const snowColor = this.palette?.snowColor ?? 0xffffff;
    const snowPeakThreshold = this.palette?.snowPeakThreshold ?? 150;
    const mountainCount = 26;
    const minDistanceToTrack = 140; // Mountains must be at least 140m from any track spline point

    for (let i = 0; i < mountainCount; i++) {
      const angle = (i / mountainCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      const baseDist = 660 + (Math.random() - 0.5) * 80;
      let x = Math.cos(angle) * baseDist;
      let z = Math.sin(angle) * baseDist;

      const peakHeight = 110 + Math.random() * 120;
      const baseRadius = 80 + Math.random() * 50;

      const testPos = new THREE.Vector3(x, 0, z);
      const info = trackData.getClosestTrackInfo(testPos);
      const actualDist = testPos.distanceTo(info.trackPoint);

      // Push too-close mountains outward.
      if (actualDist < baseRadius + minDistanceToTrack) {
        const pushDir = new THREE.Vector3().subVectors(testPos, info.trackPoint).normalize();
        pushDir.y = 0;
        testPos.copy(info.trackPoint).addScaledVector(pushDir, baseRadius + minDistanceToTrack + 20);
        x = testPos.x;
        z = testPos.z;
      }

      const segments = 5 + Math.floor(Math.random() * 2);
      const coneGeo = new THREE.ConeGeometry(baseRadius, peakHeight, segments);
      const color = mountainColors[i % mountainColors.length];
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        flatShading: true
      });

      const cone = new THREE.Mesh(coneGeo, mat);
      cone.position.set(x, peakHeight / 2 - 10, z);
      cone.rotation.y = Math.random() * Math.PI;
      this.group.add(cone);

      if (peakHeight > snowPeakThreshold) {
        const snowGeo = new THREE.ConeGeometry(baseRadius * 0.35, peakHeight * 0.35, segments);
        const snowMat = new THREE.MeshStandardMaterial({
          color: snowColor,
          roughness: 0.6,
          flatShading: true
        });
        const snow = new THREE.Mesh(snowGeo, snowMat);
        snow.position.set(x, peakHeight * 0.82, z);
        snow.rotation.y = cone.rotation.y;
        this.group.add(snow);
      }
    }
  }

  private buildTrees(trackData: TrackData) {
    type Xf = { pos: THREE.Vector3; scale: number; rotY: number };
    const pineLower: Xf[] = [];
    const pineUpper: Xf[] = [];
    const round: Xf[] = [];
    const trunks: Xf[] = [];

    const treeCount = 170;
    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 420;
      const testPos = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);

      const info = trackData.getClosestTrackInfo(testPos);
      if (info.distanceToCenter < 28.0) {
        continue;
      }

      const s = 0.8 + Math.random() * 0.7;
      const rotY = Math.random() * Math.PI;
      const base = new THREE.Vector3(testPos.x, 0, testPos.z);
      trunks.push({ pos: base.clone(), scale: s, rotY });

      const isPine = Math.random() > 0.45;
      if (isPine) {
        pineLower.push({ pos: base.clone(), scale: s, rotY });
        pineUpper.push({ pos: base.clone(), scale: s, rotY });
      } else {
        round.push({ pos: base.clone(), scale: s, rotY });
      }
    }

    const trunkMat = new THREE.MeshStandardMaterial({ color: this.palette?.trunkColor ?? 0x78350f, roughness: 0.9 });
    const fol = this.palette?.foliageColors ?? [0x15803d, 0x16a34a];
    const treeMat1 = new THREE.MeshStandardMaterial({ color: fol[0], flatShading: true, roughness: 0.8 });
    const treeMat2 = new THREE.MeshStandardMaterial({ color: fol[1 % fol.length], flatShading: true, roughness: 0.8 });

    const dummy = new THREE.Object3D();
    const fillInstances = (
      mesh: THREE.InstancedMesh, list: Xf[], yOff: number, yScale = 1,
    ) => {
      list.forEach((t, i) => {
        dummy.position.set(t.pos.x, yOff * t.scale, t.pos.z);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.scale.set(t.scale, t.scale * yScale, t.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.group.add(mesh);
    };

    if (trunks.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 5);
      fillInstances(new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length), trunks, 1.5);
    }
    if (pineLower.length > 0) {
      const pineGeo = new THREE.ConeGeometry(3.5, 6.5, 5);
      fillInstances(new THREE.InstancedMesh(pineGeo, treeMat1, pineLower.length), pineLower, 5.5);
      fillInstances(new THREE.InstancedMesh(pineGeo, treeMat2, pineUpper.length), pineUpper.map((t) => ({
        ...t, pos: new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z),
      })), 8.0);
      // Upper tier is smaller; rewrite those instances at 0.7 scale.
      const upperMesh = this.group.children[this.group.children.length - 1] as THREE.InstancedMesh;
      pineUpper.forEach((t, i) => {
        dummy.position.set(t.pos.x, 8.0 * t.scale, t.pos.z);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.scale.set(t.scale * 0.7, t.scale * 0.7, t.scale * 0.7);
        dummy.updateMatrix();
        upperMesh.setMatrixAt(i, dummy.matrix);
      });
      upperMesh.instanceMatrix.needsUpdate = true;
    }
    if (round.length > 0) {
      const roundGeo = new THREE.DodecahedronGeometry(3.2);
      fillInstances(new THREE.InstancedMesh(roundGeo, treeMat2, round.length), round, 5.0);
    }
  }

  private buildClouds() {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: this.palette?.cloudColor ?? 0xffffff,
      roughness: 0.5,
      flatShading: true,
      transparent: true,
      opacity: 0.95
    });

    const cloudCount = 18;
    for (let i = 0; i < cloudCount; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + Math.floor(Math.random() * 4);

      for (let p = 0; p < puffs; p++) {
        const radius = 8 + Math.random() * 12;
        const puffGeo = new THREE.DodecahedronGeometry(radius, 1);
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        puff.position.set(
          (p - puffs / 2) * 12 + (Math.random() - 0.5) * 6,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 10
        );
        cloud.add(puff);
      }

      cloud.position.set(
        (Math.random() - 0.5) * 1300,
        140 + Math.random() * 80,
        (Math.random() - 0.5) * 1300
      );

      this.clouds.push(cloud);
      this.group.add(cloud);
    }
  }

  public update(delta: number) {
    for (const cloud of this.clouds) {
      cloud.position.x += 4.0 * delta;
      if (cloud.position.x > 750) {
        cloud.position.x = -750;
      }
    }
  }
}
