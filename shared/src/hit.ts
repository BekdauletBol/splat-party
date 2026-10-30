// Pure geometry helpers, used by server hit detection and client aim assist-free targeting.
import { CAPSULE, COMBAT } from './constants';

export const HIT_RADIUS = CAPSULE.radius + COMBAT.hitboxPad;

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t = -b - sq;
  if (t >= 0) return t;
  return -b + sq >= 0 ? 0 : -1;
}

/** Ray (unit dir) vs vertical capsule centred at c. Returns hit distance or -1. */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, cx: number, cy: number, cz: number, halfHeight: number = CAPSULE.halfHeight, radius: number = HIT_RADIUS): number {
  let best = -1;
  const a = dx * dx + dz * dz;
  const lx = ox - cx;
  const lz = oz - cz;
  if (a > 1e-9) {
    const b = lx * dx + lz * dz;
    const c = lx * lx + lz * lz - radius * radius;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = oy + dy * t - cy;
        if (y >= -halfHeight && y <= halfHeight) best = t;
      }
    }
  }
  if (best < 0) {
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, cx, cy + halfHeight, cz, radius);
    const t2 = raySphere(ox, oy, oz, dx, dy, dz, cx, cy - halfHeight, cz, radius);
    if (t1 >= 0) best = t1;
    if (t2 >= 0 && (best < 0 || t2 < best)) best = t2;
  }
  return best >= 0 && best <= maxDist ? best : -1;
}

/** Distance from a point to a vertical capsule's axis segment. */
export function distToCapsuleAxis(px: number, py: number, pz: number, cx: number, cy: number, cz: number, halfHeight: number = CAPSULE.halfHeight): number {
  const dy = Math.max(Math.abs(py - cy) - halfHeight, 0);
  return Math.hypot(px - cx, dy, pz - cz);
}

/** Explosion falloff: 1 at the centre, 0 at the radius edge. */
export function explosionFalloff(dist: number, radius: number): number {
  return dist >= radius ? 0 : 1 - dist / radius;
}

/** Fire origin, shared so the client aims from the exact spot the server shoots from. */
export function muzzleOf(x: number, y: number, z: number, yaw: number): { x: number; y: number; z: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: x - sin * COMBAT.muzzleForward + cos * COMBAT.muzzleRight,
    y: y + COMBAT.muzzleHeight,
    z: z - cos * COMBAT.muzzleForward - sin * COMBAT.muzzleRight,
  };
}
