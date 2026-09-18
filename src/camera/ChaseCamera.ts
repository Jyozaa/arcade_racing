import * as THREE from 'three';
import { PlayerCar } from '../car/PlayerCar';

export class ChaseCamera {
  public camera: THREE.PerspectiveCamera;
  private targetPosition: THREE.Vector3 = new THREE.Vector3();
  private targetLookAt: THREE.Vector3 = new THREE.Vector3();
  private currentLookAt: THREE.Vector3 = new THREE.Vector3();

  private cameraDistance: number = 8.8;
  private cameraHeight: number = 3.8;
  private lookAheadDistance: number = 12.0;
  private lookAheadHeight: number = 1.0;

  private baseFov: number = 60;
  private maxFov: number = 74;

  private trauma: number = 0;
  private shakeOffset: THREE.Vector3 = new THREE.Vector3();

  constructor(aspectRatio: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspectRatio, 0.1, 1500);
    this.camera.position.set(0, 10, 20);
  }

  // Screen shake 0..1.
  public addShake(amount: number) {
    this.trauma = THREE.MathUtils.clamp(this.trauma + amount, 0, 1);
  }

  public update(player: PlayerCar, delta: number) {
    const carPos = player.position;
    const carForward = player.forward;

    const nitroPull = player.nitroActive ? 1.1 : 0;
    const dist = this.cameraDistance + nitroPull;

    this.targetPosition.copy(carPos)
      .addScaledVector(carForward, -dist)
      .add(new THREE.Vector3(0, this.cameraHeight, 0));

    this.targetLookAt.copy(carPos)
      .addScaledVector(carForward, this.lookAheadDistance)
      .add(new THREE.Vector3(0, this.lookAheadHeight, 0));

    const posDamp = 8.0;
    this.camera.position.lerp(this.targetPosition, Math.min(1.0, posDamp * delta));

    this.trauma = Math.max(0, this.trauma - delta * 1.6);
    if (this.trauma > 0.001) {
      const s = this.trauma * this.trauma * 0.9;
      this.shakeOffset.set(
        (Math.random() - 0.5) * s,
        (Math.random() - 0.5) * s * 0.7,
        (Math.random() - 0.5) * s,
      );
      this.camera.position.add(this.shakeOffset);
    }

    const lookDamp = 10.0;
    this.currentLookAt.lerp(this.targetLookAt, Math.min(1.0, lookDamp * delta));
    this.camera.lookAt(this.currentLookAt);

    const speedRatio = THREE.MathUtils.clamp(Math.abs(player.speed) / player.maxSpeedRoad, 0, 1);
    let targetFov = THREE.MathUtils.lerp(this.baseFov, this.maxFov, speedRatio);
    if (player.nitroActive) targetFov = Math.min(82, targetFov + 6);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 5.0 * delta);
    this.camera.updateProjectionMatrix();
  }

  public reset(player: PlayerCar) {
    const carPos = player.position;
    const carForward = player.forward;
    this.camera.position.copy(carPos)
      .addScaledVector(carForward, -this.cameraDistance)
      .add(new THREE.Vector3(0, this.cameraHeight, 0));
    this.currentLookAt.copy(carPos)
      .addScaledVector(carForward, this.lookAheadDistance);
    this.camera.lookAt(this.currentLookAt);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  public setAspectRatio(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
