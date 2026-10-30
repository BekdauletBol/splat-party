import { describe, expect, it } from 'vitest';
import { CAPSULE, COMBAT, HIT_RADIUS, distToCapsuleAxis, explosionFalloff, muzzleOf, rayCapsule } from '../src';

describe('rayCapsule', () => {
  it('hits a capsule straight ahead at the expected distance', () => {
    const t = rayCapsule(0, 0, 0, 0, 0, -1, 100, 0, 0, -10);
    expect(t).toBeCloseTo(10 - HIT_RADIUS, 5);
  });
  it('misses when the ray passes beside it', () => {
    expect(rayCapsule(0, 0, 0, 0, 0, -1, 100, HIT_RADIUS + 0.1, 0, -10)).toBe(-1);
  });
  it('respects max distance, which is how walls block shots', () => {
    expect(rayCapsule(0, 0, 0, 0, 0, -1, 5, 0, 0, -10)).toBe(-1);
  });
  it('hits the round top cap above the cylinder part', () => {
    const y = CAPSULE.halfHeight + HIT_RADIUS * 0.5;
    expect(rayCapsule(0, y, 0, 0, 0, -1, 100, 0, 0, -10)).toBeGreaterThan(0);
  });
  it('lag compensation: a target that moved is hit only at its rewound position', () => {
    const past = { x: 0, y: 0, z: -10 };
    const now = { x: 5, y: 0, z: -10 };
    expect(rayCapsule(0, 0, 0, 0, 0, -1, 100, now.x, now.y, now.z)).toBe(-1);
    expect(rayCapsule(0, 0, 0, 0, 0, -1, 100, past.x, past.y, past.z)).toBeGreaterThan(0);
  });
});

describe('explosions', () => {
  it('falloff is 1 at the centre and 0 at the edge', () => {
    expect(explosionFalloff(0, 5)).toBe(1);
    expect(explosionFalloff(5, 5)).toBe(0);
    expect(explosionFalloff(9, 5)).toBe(0);
    expect(explosionFalloff(2.5, 5)).toBeCloseTo(0.5);
  });
  it('measures distance to the capsule axis, not its centre', () => {
    expect(distToCapsuleAxis(0, CAPSULE.halfHeight, 0, 0, 0, 0)).toBe(0);
    expect(distToCapsuleAxis(1, 0, 0, 0, 0, 0)).toBe(1);
  });
});

describe('muzzle', () => {
  it('sits in front of the player, facing the yaw', () => {
    const m = muzzleOf(0, 0, 0, 0);
    expect(m.z).toBeCloseTo(-COMBAT.muzzleForward);
    expect(m.x).toBeCloseTo(COMBAT.muzzleRight);
    expect(m.y).toBeCloseTo(COMBAT.muzzleHeight);
  });
});
