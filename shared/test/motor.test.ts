import { beforeAll, describe, expect, it } from 'vitest';
import { Btn, CHARACTERS, MAPS, MotorState, MotorWorld, PHYS, buildMapWorld, copyMotorState, initPhysics, makeMotorState, stepMotor } from '../src';

let mw: MotorWorld;
beforeAll(async () => {
  await initPhysics();
  mw = buildMapWorld(MAPS.playground);
});

const idle = { mx: 0, mz: 0, y: 0, b: 0 };
function settle(s: MotorState, ticks = 60): void {
  for (let i = 0; i < ticks; i++) stepMotor(s, idle, 'cactus', mw);
}

describe('motor', () => {
  it('falls under gravity and lands on the ground', () => {
    const s = makeMotorState(-24, 5, 24);
    settle(s, 90);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeGreaterThan(0.8);
    expect(s.y).toBeLessThan(1.2);
  });

  it('walks forward (-z at yaw 0) close to max speed', () => {
    const s = makeMotorState(-24, 2, 24);
    settle(s);
    const z0 = s.z;
    for (let i = 0; i < 30; i++) stepMotor(s, { mx: 0, mz: 1, y: 0, b: 0 }, 'cactus', mw);
    expect(z0 - s.z).toBeGreaterThan(PHYS.moveSpeed * 0.7);
  });

  it('jumps only once without a double-jump passive', () => {
    const s = makeMotorState(-24, 2, 24);
    settle(s);
    const ev = { ...stepMotor(s, { ...idle, b: Btn.Jump }, 'cactus', mw) };
    expect(ev.jumped).toBe(true);
    stepMotor(s, idle, 'cactus', mw);
    const second = { ...stepMotor(s, { ...idle, b: Btn.Jump }, 'cactus', mw) };
    expect(second.doubleJumped).toBe(false);
  });

  it('gives the duck a double jump', () => {
    const s = makeMotorState(-24, 2, 24);
    for (let i = 0; i < 60; i++) stepMotor(s, idle, 'duck', mw);
    stepMotor(s, { ...idle, b: Btn.Jump }, 'duck', mw);
    stepMotor(s, idle, 'duck', mw);
    const second = { ...stepMotor(s, { ...idle, b: Btn.Jump }, 'duck', mw) };
    expect(second.doubleJumped).toBe(true);
  });

  it('jelly jumps higher and bounces on landing', () => {
    expect(CHARACTERS.jelly.jumpMul).toBeGreaterThan(1);
    const s = makeMotorState(-24, 12, 24);
    let bounced = false;
    for (let i = 0; i < 90; i++) bounced = stepMotor(s, idle, 'jelly', mw).bounced || bounced;
    expect(bounced).toBe(true);
  });

  it('knockback exceeds run speed and decays by friction', () => {
    const s = makeMotorState(-24, 2, 24);
    settle(s);
    s.vx = 30;
    stepMotor(s, idle, 'cactus', mw);
    expect(s.vx).toBeGreaterThan(PHYS.moveSpeed);
    for (let i = 0; i < 60; i++) stepMotor(s, idle, 'cactus', mw);
    expect(Math.abs(s.vx)).toBeLessThan(1);
  });

  it('is deterministic: replaying the same inputs reproduces the state', () => {
    const a = makeMotorState(-24, 2, 24);
    const b = makeMotorState();
    copyMotorState(a, b);
    const script = Array.from({ length: 120 }, (_, i) => ({ mx: Math.sin(i / 9), mz: 1, y: i / 40, b: i % 30 === 0 ? Btn.Jump : 0 }));
    for (const inp of script) stepMotor(a, inp, 'duck', mw);
    for (const inp of script) stepMotor(b, inp, 'duck', mw);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });

  it('bubble floats the player upward without control', () => {
    const s = makeMotorState(-24, 2, 24);
    settle(s);
    s.bubble = 10;
    const y0 = s.y;
    const x0 = s.x;
    for (let i = 0; i < 10; i++) stepMotor(s, { mx: 1, mz: 0, y: 0, b: 0 }, 'cactus', mw);
    expect(s.y).toBeGreaterThan(y0 + 0.5);
    expect(s.x).toBeCloseTo(x0, 3);
  });
});
