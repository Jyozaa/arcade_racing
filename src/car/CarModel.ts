import * as THREE from 'three';

export interface CarColorConfig {
  bodyColor: number;       // Upper monocoque / nose
  accentColor: number;     // Central fin / stripes / wing blade (e.g. white)
  sideColor?: number;      // Lower sidepod / flanks (e.g. blue)
  helmetColor: number;
  numberColor?: number;
}

export class CarModel {
  public mesh: THREE.Group;
  public frontLeftWheelPivot: THREE.Group;
  public frontRightWheelPivot: THREE.Group;
  public frontLeftWheel: THREE.Mesh;
  public frontRightWheel: THREE.Mesh;
  public rearLeftWheel: THREE.Mesh;
  public rearRightWheel: THREE.Mesh;

  public frontWheelRadius: number = 0.44;
  public rearWheelRadius: number = 0.62;

  private brakeLightMat!: THREE.MeshStandardMaterial;
  private nitroFlameL!: THREE.Mesh;
  private nitroFlameR!: THREE.Mesh;
  private nitroFlameMat!: THREE.MeshBasicMaterial;
  private flagCanvas!: HTMLCanvasElement;
  private flagTexture!: THREE.CanvasTexture;

  constructor(config: CarColorConfig) {
    this.mesh = new THREE.Group();

    const sideColor = config.sideColor ?? 0x2563eb;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: config.bodyColor,
      roughness: 0.4,
      metalness: 0.15,
      flatShading: true,
    });

    const sideMat = new THREE.MeshStandardMaterial({
      color: sideColor,
      roughness: 0.4,
      metalness: 0.15,
      flatShading: true,
    });

    const whiteMat = new THREE.MeshStandardMaterial({
      color: config.accentColor,
      roughness: 0.35,
      metalness: 0.1,
      flatShading: true,
    });

    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: true,
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x27272a, // Dark chunky charcoal
      roughness: 0.9,
      metalness: 0.05,
      flatShading: true,
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x52525b,
      roughness: 0.5,
      metalness: 0.5,
      flatShading: true,
    });

    const helmetMat = new THREE.MeshStandardMaterial({
      color: config.helmetColor,
      roughness: 0.3,
      metalness: 0.1,
    });

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x09090b,
      roughness: 0.1,
      metalness: 0.8,
    });

    const suspensionMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.6,
      metalness: 0.4,
    });

    const tubGeo = new THREE.BoxGeometry(1.2, 0.4, 1.8);
    const tub = new THREE.Mesh(tubGeo, bodyMat);
    tub.position.set(0, 0.4, -0.1);
    tub.castShadow = true;
    this.mesh.add(tub);

    const sidepodGeo = new THREE.BoxGeometry(0.38, 0.32, 1.5);
    const leftSidepod = new THREE.Mesh(sidepodGeo, sideMat);
    leftSidepod.position.set(-0.72, 0.36, -0.05);
    leftSidepod.castShadow = true;
    this.mesh.add(leftSidepod);

    const rightSidepod = new THREE.Mesh(sidepodGeo, sideMat);
    rightSidepod.position.set(0.72, 0.36, -0.05);
    rightSidepod.castShadow = true;
    this.mesh.add(rightSidepod);

    const cockpitCutoutGeo = new THREE.BoxGeometry(0.65, 0.15, 0.75);
    const cockpitCutout = new THREE.Mesh(cockpitCutoutGeo, darkMat);
    cockpitCutout.position.set(0, 0.52, -0.2);
    this.mesh.add(cockpitCutout);

    const helmetGeo = new THREE.SphereGeometry(0.22, 10, 10);
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.set(0, 0.72, -0.15);
    helmet.castShadow = true;
    this.mesh.add(helmet);

    const visorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.16);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.72, -0.25);
    this.mesh.add(visor);

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0, 0.45);
    finShape.lineTo(1.1, 0.1);
    finShape.lineTo(1.1, 0);
    finShape.closePath();

    const extrudeSettings = { depth: 0.1, bevelEnabled: false };
    const finGeo = new THREE.ExtrudeGeometry(finShape, extrudeSettings);
    finGeo.rotateY(-Math.PI / 2);
    const sharkFin = new THREE.Mesh(finGeo, whiteMat);
    sharkFin.position.set(0.05, 0.55, 0.0);
    sharkFin.castShadow = true;
    this.mesh.add(sharkFin);

    const engineCoverGeo = new THREE.BoxGeometry(0.7, 0.32, 1.0);
    const engineCover = new THREE.Mesh(engineCoverGeo, bodyMat);
    engineCover.position.set(0, 0.45, 0.5);
    engineCover.castShadow = true;
    this.mesh.add(engineCover);

    const noseGeo = new THREE.ConeGeometry(0.6, 1.7, 4);
    noseGeo.rotateY(Math.PI / 4);
    noseGeo.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeo, bodyMat);
    nose.position.set(0, 0.32, -1.8);
    nose.scale.set(0.9, 0.32, 1.0);
    nose.castShadow = true;
    this.mesh.add(nose);

    const fWingGeo = new THREE.BoxGeometry(2.1, 0.06, 0.4);
    const fWing = new THREE.Mesh(fWingGeo, whiteMat);
    fWing.position.set(0, 0.16, -2.4);
    fWing.castShadow = true;
    this.mesh.add(fWing);

    const fEndplateGeo = new THREE.BoxGeometry(0.05, 0.22, 0.44);
    const fEndL = new THREE.Mesh(fEndplateGeo, bodyMat);
    fEndL.position.set(-1.05, 0.22, -2.4);
    this.mesh.add(fEndL);

    const fEndR = new THREE.Mesh(fEndplateGeo, bodyMat);
    fEndR.position.set(1.05, 0.22, -2.4);
    this.mesh.add(fEndR);

    const rEndplateGeo = new THREE.BoxGeometry(0.08, 0.65, 0.7);
    const rEndL = new THREE.Mesh(rEndplateGeo, bodyMat);
    rEndL.position.set(-0.85, 0.78, 1.4);
    rEndL.castShadow = true;
    this.mesh.add(rEndL);

    const rEndR = new THREE.Mesh(rEndplateGeo, bodyMat);
    rEndR.position.set(0.85, 0.78, 1.4);
    rEndR.castShadow = true;
    this.mesh.add(rEndR);

    const rWingGeo = new THREE.BoxGeometry(1.7, 0.08, 0.5);
    const rWing = new THREE.Mesh(rWingGeo, whiteMat);
    rWing.position.set(0, 0.95, 1.35);
    rWing.castShadow = true;
    this.mesh.add(rWing);

    const diffuserGeo = new THREE.BoxGeometry(0.9, 0.25, 0.4);
    const diffuser = new THREE.Mesh(diffuserGeo, darkMat);
    diffuser.position.set(0, 0.25, 1.3);
    this.mesh.add(diffuser);

    const exhaustGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaust = new THREE.Mesh(exhaustGeo, darkMat);
    exhaust.position.set(0, 0.35, 1.45);
    this.mesh.add(exhaust);

    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.15,
      roughness: 0.3,
    });
    const brakeGeo = new THREE.BoxGeometry(0.9, 0.1, 0.06);
    const brakeLight = new THREE.Mesh(brakeGeo, this.brakeLightMat);
    brakeLight.position.set(0, 0.52, 1.52);
    this.mesh.add(brakeLight);

    this.nitroFlameMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.9,
    });
    const flameGeo = new THREE.ConeGeometry(0.09, 0.7, 6);
    flameGeo.rotateX(Math.PI / 2); // point backwards (+Z)
    this.nitroFlameL = new THREE.Mesh(flameGeo, this.nitroFlameMat);
    this.nitroFlameL.position.set(-0.12, 0.35, 1.85);
    this.nitroFlameL.visible = false;
    this.mesh.add(this.nitroFlameL);
    this.nitroFlameR = new THREE.Mesh(flameGeo, this.nitroFlameMat);
    this.nitroFlameR.position.set(0.12, 0.35, 1.85);
    this.nitroFlameR.visible = false;
    this.mesh.add(this.nitroFlameR);

    this.flagCanvas = document.createElement('canvas');
    this.flagCanvas.width = 128;
    this.flagCanvas.height = 128;
    this.flagTexture = new THREE.CanvasTexture(this.flagCanvas);
    this.flagTexture.colorSpace = THREE.SRGBColorSpace;
    const flagMat = new THREE.MeshBasicMaterial({ map: this.flagTexture, transparent: true });
    const flagMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), flagMat);
    flagMesh.rotation.x = -Math.PI / 2;
    flagMesh.position.set(0, 1.0, 1.35);
    this.mesh.add(flagMesh);
    this.setFlagDecal('🏁');

    const fTrackWidth = 1.15;
    const rTrackWidth = 1.38;
    const fAxleZ = -1.65;
    const rAxleZ = 1.15;

    const fTireWidth = 0.38;
    const rTireWidth = 0.68;

    const createTyre = (radius: number, width: number) => {
      const g = new THREE.Group();
      const tGeo = new THREE.CylinderGeometry(radius, radius, width, 10);
      tGeo.rotateZ(Math.PI / 2);
      const tyre = new THREE.Mesh(tGeo, tireMat);
      tyre.castShadow = true;
      g.add(tyre);

      const rGeo = new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width * 1.02, 8);
      rGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rGeo, rimMat);
      g.add(rim);

      return g;
    };

    this.frontLeftWheelPivot = new THREE.Group();
    this.frontLeftWheelPivot.position.set(-fTrackWidth, this.frontWheelRadius, fAxleZ);
    this.frontLeftWheel = createTyre(this.frontWheelRadius, fTireWidth) as unknown as THREE.Mesh;
    this.frontLeftWheelPivot.add(this.frontLeftWheel);
    this.mesh.add(this.frontLeftWheelPivot);

    this.frontRightWheelPivot = new THREE.Group();
    this.frontRightWheelPivot.position.set(fTrackWidth, this.frontWheelRadius, fAxleZ);
    this.frontRightWheel = createTyre(this.frontWheelRadius, fTireWidth) as unknown as THREE.Mesh;
    this.frontRightWheelPivot.add(this.frontRightWheel);
    this.mesh.add(this.frontRightWheelPivot);

    this.addWishbone(-fTrackWidth * 0.5, this.frontWheelRadius, fAxleZ, suspensionMat, false);
    this.addWishbone(fTrackWidth * 0.5, this.frontWheelRadius, fAxleZ, suspensionMat, true);

    this.rearLeftWheel = createTyre(this.rearWheelRadius, rTireWidth) as unknown as THREE.Mesh;
    this.rearLeftWheel.position.set(-rTrackWidth, this.rearWheelRadius, rAxleZ);
    this.mesh.add(this.rearLeftWheel);

    this.rearRightWheel = createTyre(this.rearWheelRadius, rTireWidth) as unknown as THREE.Mesh;
    this.rearRightWheel.position.set(rTrackWidth, this.rearWheelRadius, rAxleZ);
    this.mesh.add(this.rearRightWheel);

    this.addWishbone(-rTrackWidth * 0.5, this.rearWheelRadius, rAxleZ, suspensionMat, false);
    this.addWishbone(rTrackWidth * 0.5, this.rearWheelRadius, rAxleZ, suspensionMat, true);
  }

  private addWishbone(x: number, y: number, z: number, mat: THREE.Material, isRight: boolean) {
    const geo = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6);
    geo.rotateZ(isRight ? -Math.PI / 3.2 : Math.PI / 3.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.mesh.add(mesh);
  }

  public updateVisuals(steeringAngle: number, speed: number, delta: number) {
    this.frontLeftWheelPivot.rotation.y = steeringAngle;
    this.frontRightWheelPivot.rotation.y = steeringAngle;

    const fRoll = (speed / this.frontWheelRadius) * delta;
    const rRoll = (speed / this.rearWheelRadius) * delta;

    this.frontLeftWheel.rotation.x += fRoll;
    this.frontRightWheel.rotation.x += fRoll;
    this.rearLeftWheel.rotation.x += rRoll;
    this.rearRightWheel.rotation.x += rRoll;

    if (this.nitroFlameL.visible) {
      const s = 0.8 + Math.random() * 0.6;
      this.nitroFlameL.scale.set(1, 1, s);
      this.nitroFlameR.scale.set(1, 1, 2 - s * 0.9);
    }
  }

  public setBrakeLight(on: boolean) {
    if (!this.brakeLightMat) return;
    this.brakeLightMat.emissiveIntensity = on ? 2.2 : 0.15;
  }

  public setNitroFlames(on: boolean) {
    if (!this.nitroFlameL) return;
    this.nitroFlameL.visible = on;
    this.nitroFlameR.visible = on;
  }

  public setFlagDecal(emoji: string) {
    if (!this.flagCanvas) return;
    const ctx = this.flagCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '96px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    this.flagTexture.needsUpdate = true;
  }
}
