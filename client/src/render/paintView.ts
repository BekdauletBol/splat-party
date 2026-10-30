// Paint decals: one instanced round splat per painted cell, laid on the floor's
// surface. The client rebuilds the same grid the server has from the same map.
import * as THREE from 'three';
import { MotorWorld, PAINT, PaintGrid, RENDER, TEAM_COLORS, surfaceRay } from '@splat/shared';

const SPLAT_LIFT = 0.04;
const SPLAT_SCALE = 1.05;

export class PaintView {
  readonly grid: PaintGrid;
  readonly mesh: THREE.InstancedMesh;
  /** Instance slot per cell, -1 when unpainted. */
  private slot: Int32Array;
  private free: number[] = [];
  private used = 0;
  private dummy = new THREE.Object3D();
  private up = new THREE.Vector3(0, 0, 1);
  private normal = new THREE.Vector3();
  private colors = TEAM_COLORS.map((c) => new THREE.Color(c));

  constructor(mw: MotorWorld) {
    this.grid = new PaintGrid(mw.map.bounds);
    this.grid.scan((x, z) => surfaceRay(mw, x, z, PAINT.rayStartY, PAINT.rayLength));
    const capacity = Math.min(RENDER.maxPaintSplats, this.grid.paintable);
    const geo = new THREE.CircleGeometry(PAINT.cellSize * 0.72, 10);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, this.colors[0]);
    this.slot = new Int32Array(this.grid.cells.length).fill(-1);
  }

  private place(i: number, team: number): void {
    const g = this.grid;
    let s = this.slot[i];
    if (s < 0) {
      if (this.free.length) s = this.free.pop() as number;
      else if (this.used < this.mesh.instanceMatrix.count) s = this.used++;
      else return;
      this.slot[i] = s;
      this.dummy.position.set(g.cellX(i % g.cols), g.surface[i] + SPLAT_LIFT, g.cellZ(Math.floor(i / g.cols)));
      this.normal.set(g.normalX[i], g.normalY[i], g.normalZ[i]);
      this.dummy.quaternion.setFromUnitVectors(this.up, this.normal);
      this.dummy.rotateZ(i * 2.4); // varied circles look less like a grid
      this.dummy.scale.setScalar(SPLAT_SCALE);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(s, this.dummy.matrix);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    this.mesh.setColorAt(s, this.colors[team]);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.used;
  }

  applyDelta(flat: number[]): void {
    for (let k = 0; k + 1 < flat.length; k += 2) {
      const i = flat[k];
      const team = flat[k + 1];
      if (this.grid.set(i, team) && team >= 0) this.place(i, team);
    }
  }

  applyFull(cells: number[]): void {
    this.reset();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] >= 0) {
        this.grid.set(i, cells[i]);
        this.place(i, cells[i]);
      }
    }
  }

  reset(): void {
    this.grid.clear();
    this.slot.fill(-1);
    this.free.length = 0;
    this.used = 0;
    this.mesh.count = 0;
  }
}
