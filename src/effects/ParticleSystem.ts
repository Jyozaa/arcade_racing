import * as THREE from 'three';

interface Particle {
  alive: boolean;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
}

// Pooled point sprites: one draw call for smoke, sparks, dust, and nitro.
export class ParticleSystem {
  public points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private particles: Particle[] = [];
  private max: number;
  private cursor: number = 0;
  private tmpColor = new THREE.Color();

  constructor(max: number = 900) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    const positions = new Float32Array(max * 3);
    const colors = new Float32Array(max * 3);
    const sizes = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      positions[i * 3 + 1] = -1000;
      this.particles.push({
        alive: false, life: 0, maxLife: 1,
        velocity: new THREE.Vector3(), size: 0,
        color: new THREE.Color(1, 1, 1), gravity: 0, drag: 0,
      });
    }
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setAttribute('size', this.sizeAttr);

    const mat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    // Fade with size attenuation would need a custom shader; brightness
    // fades with life instead and the size attribute stays reserved.
    void this.sizeAttr;
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  private spawn(
    pos: THREE.Vector3, vel: THREE.Vector3,
    color: THREE.Color, life: number, gravity = 0, drag = 0, jitter = 0.5,
  ) {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.alive = true;
    p.life = life;
    p.maxLife = life;
    p.velocity.copy(vel);
    p.velocity.x += (Math.random() - 0.5) * jitter * 4;
    p.velocity.y += (Math.random() - 0.5) * jitter * 3;
    p.velocity.z += (Math.random() - 0.5) * jitter * 4;
    p.color.copy(color);
    p.gravity = gravity;
    p.drag = drag;
    const i3 = this.particles.indexOf(p) * 3;
    this.posAttr.array[i3] = pos.x + (Math.random() - 0.5) * 0.6;
    this.posAttr.array[i3 + 1] = pos.y + Math.random() * 0.3;
    this.posAttr.array[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.6;
  }

  public emitDriftSmoke(pos: THREE.Vector3, speed: number) {
    this.tmpColor.setHex(0xdde3ea);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 1.2 + Math.random(), (Math.random() - 0.5) * 2);
    this.spawn(pos, vel, this.tmpColor, 0.7 + Math.random() * 0.4, -1.5, 1.5, 0.8);
    void speed;
  }

  public emitGrassDust(pos: THREE.Vector3) {
    this.tmpColor.setHex(0x86c06c);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
    this.spawn(pos, vel, this.tmpColor, 0.6 + Math.random() * 0.3, -4, 1.2, 1.0);
  }

  public emitSparks(pos: THREE.Vector3, count: number = 6) {
    for (let i = 0; i < count; i++) {
      this.tmpColor.setHex(Math.random() > 0.4 ? 0xffd23f : 0xff7b1c);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        2 + Math.random() * 5,
        (Math.random() - 0.5) * 12,
      );
      this.spawn(pos, vel, this.tmpColor, 0.35 + Math.random() * 0.3, -14, 0.4, 0.4);
    }
  }

  public emitNitro(pos: THREE.Vector3, forward: THREE.Vector3) {
    this.tmpColor.setHex(Math.random() > 0.5 ? 0x22d3ee : 0x818cf8);
    const vel = new THREE.Vector3().copy(forward).multiplyScalar(-14 - Math.random() * 6);
    vel.y += 1.0;
    this.spawn(pos, vel, this.tmpColor, 0.3 + Math.random() * 0.2, 0, 2.0, 0.5);
  }

  public update(delta: number) {
    const posArr = this.posAttr.array as Float32Array;
    const colArr = this.colAttr.array as Float32Array;
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      const i3 = i * 3;
      if (!p.alive) {
        colArr[i3] = colArr[i3 + 1] = colArr[i3 + 2] = 0;
        continue;
      }
      p.life -= delta;
      if (p.life <= 0) {
        p.alive = false;
        posArr[i3 + 1] = -1000;
        colArr[i3] = colArr[i3 + 1] = colArr[i3 + 2] = 0;
        continue;
      }
      p.velocity.y += p.gravity * delta;
      if (p.drag > 0) {
        const d = Math.max(0, 1 - p.drag * delta);
        p.velocity.multiplyScalar(d);
      }
      posArr[i3] += p.velocity.x * delta;
      posArr[i3 + 1] += p.velocity.y * delta;
      posArr[i3 + 2] += p.velocity.z * delta;
      if (posArr[i3 + 1] < 0.05) posArr[i3 + 1] = 0.05;
      const f = p.life / p.maxLife;
      colArr[i3] = p.color.r * (0.35 + 0.65 * f);
      colArr[i3 + 1] = p.color.g * (0.35 + 0.65 * f);
      colArr[i3 + 2] = p.color.b * (0.35 + 0.65 * f);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
