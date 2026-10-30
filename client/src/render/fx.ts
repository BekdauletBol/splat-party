// Pooled visual effects: paint droplets, poof clouds, tracers, shockwaves, ragdolls.
import * as THREE from 'three';
import { RENDER } from '@splat/shared';

interface Particle {
  life: number;
  max: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
  grow: number;
  gravity: number;
  r: number; g: number; b: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}
interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}
interface Piece {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
  groundY: number;
}
interface Ragdoll {
  pieces: Piece[];
  life: number;
}

const TRACER_LIFE = 0.08;
const RAGDOLL_GRAVITY = 26;
const FX_DAMP = 0.42;

export class Fx {
  private particles: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private cursor = 0;
  private tracers: Tracer[] = [];
  private rings: Ring[] = [];
  private ragdolls: Ragdoll[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateX(Math.PI / 2);
  private ringGeo = new THREE.TorusGeometry(1, 0.1, 6, 32).rotateX(Math.PI / 2);
  particleScale = 1;

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, RENDER.maxParticles);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    scene.add(this.mesh);
    for (let i = 0; i < RENDER.maxParticles; i++) {
      this.particles.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, grow: 0, gravity: 0, r: 1, g: 1, b: 1 });
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: number, gravity: number, grow = 0): void {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    p.life = p.max = life;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size;
    p.grow = grow;
    p.gravity = gravity;
    this.color.setHex(color);
    p.r = this.color.r; p.g = this.color.g; p.b = this.color.b;
  }

  splat(x: number, y: number, z: number, color: number, count = 8, power = 5): void {
    const n = Math.ceil(count * this.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = power * (0.4 + Math.random());
      this.spawn(x, y, z, Math.cos(a) * sp, up * sp + 1, Math.sin(a) * sp, 0.08 + Math.random() * 0.1, 0.4 + Math.random() * 0.3, color, 18);
    }
  }

  poof(x: number, y: number, z: number, count = 14): void {
    const n = Math.ceil(count * this.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI;
      const sp = 1.5 + Math.random() * 2.5;
      this.spawn(x, y, z, Math.cos(a) * Math.sin(b) * sp, Math.cos(b) * sp + 1, Math.sin(a) * Math.sin(b) * sp, 0.16 + Math.random() * 0.14, 0.6 + Math.random() * 0.35, 0xffffff, -1.5, 0.45);
    }
  }

  explosion(x: number, y: number, z: number, radius: number, color: number): void {
    const n = Math.ceil(28 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const sp = radius * (0.8 + Math.random() * 1.8);
      const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xffd23f : color;
      this.spawn(x, y, z, Math.cos(a) * Math.sin(b) * sp, Math.cos(b) * sp, Math.sin(a) * Math.sin(b) * sp, 0.2 + Math.random() * 0.35, 0.45 + Math.random() * 0.35, col, 8, 0.4);
    }
    this.feathers(x, y, z);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.28, max: 0.28, radius });
  }

  feathers(x: number, y: number, z: number): void {
    const n = Math.ceil(10 * this.particleScale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x, y, z, Math.cos(a) * 4, 2 + Math.random() * 4, Math.sin(a) * 4, 0.1, 1.4, 0xfff8e7, 2);
    }
  }

  trail(x: number, y: number, z: number, color: number): void {
    this.spawn(x, y, z, 0, 0.4, 0, 0.12, 0.3, color, 0, 0.3);
  }

  tracer(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    const len = Math.hypot(tx - fx, ty - fy, tz - fz);
    mesh.position.set((fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2);
    mesh.scale.set(1, 1, len);
    mesh.lookAt(tx, ty, tz);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: TRACER_LIFE });
  }

  /** Comedy death: the character's parts fly off in all directions, then poof. */
  ragdoll(parts: THREE.Mesh[], vx: number, vy: number, vz: number, groundY: number): void {
    const pieces: Piece[] = parts.map((mesh) => {
      this.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const burst = 3 + Math.random() * 6;
      return {
        mesh,
        vx: vx * 0.7 + Math.cos(a) * burst,
        vy: Math.max(vy, 0) * 0.7 + 6 + Math.random() * 7,
        vz: vz * 0.7 + Math.sin(a) * burst,
        ax: (Math.random() - 0.5) * 14,
        ay: (Math.random() - 0.5) * 14,
        az: (Math.random() - 0.5) * 14,
        groundY,
      };
    });
    this.ragdolls.push({ pieces, life: RENDER.ragdollLifeSec });
  }

  update(dt: number): void {
    let n = 0;
    const m = this.mesh;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = Math.max(0, p.life / p.max);
      const s = (p.size + p.grow * (1 - t)) * (p.grow > 0 ? t * 0.6 + 0.4 : t);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(Math.max(0.0001, s));
      this.dummy.updateMatrix();
      m.setMatrixAt(n, this.dummy.matrix);
      m.setColorAt(n, this.color.setRGB(p.r, p.g, p.b));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / TRACER_LIFE);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.radius * (0.2 + k));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      r.life -= dt;
      for (const p of r.pieces) {
        p.vy -= RAGDOLL_GRAVITY * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.rotation.x += p.ax * dt;
        p.mesh.rotation.y += p.ay * dt;
        p.mesh.rotation.z += p.az * dt;
        if (p.mesh.position.y < p.groundY && p.vy < 0) {
          p.mesh.position.y = p.groundY;
          p.vy *= -FX_DAMP;
          p.vx *= 0.7;
          p.vz *= 0.7;
        }
        if (r.life < 0.25) p.mesh.scale.multiplyScalar(0.8);
      }
      if (r.life <= 0) {
        const c = r.pieces[0]?.mesh.position;
        if (c) this.poof(c.x, c.y, c.z, 10);
        for (const p of r.pieces) this.scene.remove(p.mesh);
        this.ragdolls.splice(i, 1);
      }
    }
  }
}
