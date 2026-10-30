// Character movement. The same code runs on the server (authority) and on the
// client (prediction / replay), so it must depend only on its arguments.
import RAPIER from '@dimforge/rapier3d-compat';
import { CAPSULE, CHARACTERS, CharacterId, PHYS, TICK_DT } from './constants';
import type { BoxZone, MapDef, Prim } from './maps';

export const enum Btn {
  Jump = 1,
  Dash = 2,
  Fire = 4,
  Aim = 8,
}

export interface PlayerInput {
  /** Sequence number. */
  s: number;
  /** Strafe -1..1. */
  mx: number;
  /** Forward -1..1. */
  mz: number;
  /** Camera yaw (movement direction). */
  y: number;
  /** Fire direction yaw / pitch (muzzle → aim point). */
  ay: number;
  ap: number;
  /** Button bitmask, see Btn. */
  b: number;
  /** Selected weapon slot 0..3. */
  w: number;
  /** Server tick the client was looking at (for lag compensation). */
  v: number;
}

export const EMPTY_INPUT: Omit<PlayerInput, 's' | 'y' | 'ay' | 'ap' | 'w' | 'v'> = { mx: 0, mz: 0, b: 0 };

export interface MotorState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  jumpsUsed: number;
  coyote: number;
  dashCd: number;
  dashT: number;
  dashX: number;
  dashZ: number;
  jumpHeld: boolean;
  dashHeld: boolean;
  /** Ticks left trapped in a bubble: controls are off and the player floats up. */
  bubble: number;
}

export function makeMotorState(x = 0, y = 0, z = 0): MotorState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, jumpsUsed: 0, coyote: 0, dashCd: 0, dashT: 0, dashX: 0, dashZ: 0, jumpHeld: false, dashHeld: false, bubble: 0 };
}

export function copyMotorState(from: MotorState, to: MotorState): void {
  to.x = from.x; to.y = from.y; to.z = from.z;
  to.vx = from.vx; to.vy = from.vy; to.vz = from.vz;
  to.grounded = from.grounded; to.jumpsUsed = from.jumpsUsed; to.coyote = from.coyote;
  to.dashCd = from.dashCd; to.dashT = from.dashT; to.dashX = from.dashX; to.dashZ = from.dashZ;
  to.jumpHeld = from.jumpHeld; to.dashHeld = from.dashHeld; to.bubble = from.bubble;
}

export interface MotorEvents {
  jumped: boolean;
  doubleJumped: boolean;
  dashed: boolean;
  padded: boolean;
  /** Impact speed when landing this tick, otherwise 0. */
  landed: number;
  bounced: boolean;
}

/** Everything the motor needs to query: one static world and one probe collider. */
export class MotorWorld {
  readonly controller: RAPIER.KinematicCharacterController;
  readonly probe: RAPIER.Collider;
  private readonly desired = new RAPIER.Vector3(0, 0, 0);

  constructor(readonly world: RAPIER.World, readonly map: MapDef) {
    this.controller = world.createCharacterController(CAPSULE.skin);
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(CAPSULE.stepHeight, CAPSULE.stepMinWidth, false);
    this.controller.enableSnapToGround(CAPSULE.snapDistance);
    this.controller.setMaxSlopeClimbAngle((CAPSULE.maxClimbDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((CAPSULE.minSlideDeg * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.probe = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE.halfHeight, CAPSULE.radius).setSensor(true).setCollisionGroups(GROUP_PROBE),
    );
  }

  move(state: MotorState, dt: number): void {
    this.probe.setTranslation({ x: state.x, y: state.y, z: state.z });
    this.desired.x = state.vx * dt;
    this.desired.y = state.vy * dt;
    this.desired.z = state.vz * dt;
    this.controller.computeColliderMovement(this.probe, this.desired, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, GROUP_STATIC_FILTER);
    const m = this.controller.computedMovement();
    state.x += m.x;
    state.y += m.y;
    state.z += m.z;
  }

  get grounded(): boolean {
    return this.controller.computedGrounded();
  }
  get lastMoveY(): number {
    return this.controller.computedMovement().y;
  }
}

// Collision group masks: (memberships << 16) | filter
const STATIC_BIT = 0x0001;
const PROP_BIT = 0x0002;
const PROBE_BIT = 0x0004;
export const GROUP_STATIC = (STATIC_BIT << 16) | (STATIC_BIT | PROP_BIT | PROBE_BIT);
export const GROUP_PROP = (PROP_BIT << 16) | (STATIC_BIT | PROP_BIT);
export const GROUP_PROBE = (PROBE_BIT << 16) | STATIC_BIT;
/** Query filter that only hits level geometry. */
export const GROUP_STATIC_FILTER = (0xffff << 16) | STATIC_BIT;

function inZone(z: BoxZone, x: number, y: number, zz: number): boolean {
  return Math.abs(x - z.center[0]) <= z.half[0] && Math.abs(y - z.center[1]) <= z.half[1] + CAPSULE.halfHeight + CAPSULE.radius && Math.abs(zz - z.center[2]) <= z.half[2];
}

const scratchEvents: MotorEvents = { jumped: false, doubleJumped: false, dashed: false, padded: false, landed: 0, bounced: false };

/** Advance one fixed tick. Mutates `s`; the returned events object is reused. */
export function stepMotor(s: MotorState, input: Pick<PlayerInput, 'mx' | 'mz' | 'y' | 'b'>, charId: CharacterId, mw: MotorWorld, dt: number = TICK_DT): MotorEvents {
  const ev = scratchEvents;
  ev.jumped = ev.doubleJumped = ev.dashed = ev.padded = ev.bounced = false;
  ev.landed = 0;
  const char = CHARACTERS[charId];
  const trapped = s.bubble > 0;

  // Bubble: float up with no control, ignoring gravity and buttons.
  if (trapped) {
    s.bubble--;
    s.vx = 0;
    s.vz = 0;
    s.vy = PHYS.bubbleRiseSpeed;
    s.dashT = 0;
    s.jumpHeld = (input.b & Btn.Jump) !== 0;
    s.dashHeld = (input.b & Btn.Dash) !== 0;
    mw.move(s, dt);
    s.grounded = false;
    return ev;
  }

  let mx = input.mx;
  let mz = input.mz;
  const mlen = Math.hypot(mx, mz);
  if (mlen > 1) {
    mx /= mlen;
    mz /= mlen;
  }
  const sin = Math.sin(input.y);
  const cos = Math.cos(input.y);
  // forward = (-sin, -cos), right = (cos, -sin)
  const wishX = mx * cos - mz * sin;
  const wishZ = -mx * sin - mz * cos;
  let speedMul = char.speedMul;
  for (const sand of mw.map.sand) if (inZone(sand, s.x, s.y, s.z)) speedMul *= PHYS.sandSpeedMul;
  const maxSpeed = PHYS.moveSpeed * speedMul;

  if (s.dashCd > 0) s.dashCd--;
  const wantJump = (input.b & Btn.Jump) !== 0;
  const wantDash = (input.b & Btn.Dash) !== 0;

  // Dash
  if (wantDash && !s.dashHeld && s.dashCd <= 0) {
    const useWish = Math.hypot(wishX, wishZ) > 0.01;
    const dx = useWish ? wishX / Math.hypot(wishX, wishZ) : -sin;
    const dz = useWish ? wishZ / Math.hypot(wishX, wishZ) : -cos;
    s.dashT = PHYS.dashTicks;
    s.dashCd = Math.round(PHYS.dashCooldownTicks * (char.dashCdMul ?? 1));
    s.dashX = dx;
    s.dashZ = dz;
    ev.dashed = true;
  }
  s.dashHeld = wantDash;

  if (s.dashT > 0) {
    s.dashT--;
    s.vx = s.dashX * PHYS.dashSpeed;
    s.vz = s.dashZ * PHYS.dashSpeed;
    if (s.vy < 0) s.vy = 0;
  } else {
    // Horizontal acceleration: only limits the *wish* speed, so knockback is
    // free to exceed maxSpeed and bleed off through friction.
    const accel = s.grounded ? PHYS.groundAccel : PHYS.airAccel;
    const friction = s.grounded ? PHYS.groundFriction : PHYS.airFriction;
    const damp = Math.exp(-friction * dt);
    const hasWish = mlen > 0.01;
    if (!hasWish || Math.hypot(s.vx, s.vz) > maxSpeed) {
      s.vx *= damp;
      s.vz *= damp;
    }
    if (hasWish) {
      const dot = s.vx * wishX + s.vz * wishZ;
      const add = maxSpeed * Math.min(mlen, 1) - dot;
      if (add > 0) {
        const a = Math.min(add, accel * dt);
        s.vx += wishX * a;
        s.vz += wishZ * a;
      }
    }
  }

  // Jump (with coyote time + multi-jump)
  s.coyote = s.grounded ? PHYS.coyoteTicks : Math.max(0, s.coyote - 1);
  if (s.grounded) s.jumpsUsed = 0;
  if (wantJump && !s.jumpHeld) {
    if (s.coyote > 0) {
      s.vy = PHYS.jumpSpeed * char.jumpMul;
      s.jumpsUsed = 1;
      s.coyote = 0;
      s.grounded = false;
      ev.jumped = true;
    } else if (s.jumpsUsed < char.maxJumps || (s.jumpsUsed === 0 && char.maxJumps > 1)) {
      s.vy = PHYS.doubleJumpSpeed * char.jumpMul;
      s.jumpsUsed = Math.max(s.jumpsUsed, 1) + 1;
      ev.doubleJumped = true;
    }
  }
  s.jumpHeld = wantJump;

  // Map zones
  for (const pad of mw.map.pads) {
    if (inZone(pad, s.x, s.y, s.z) && s.vy <= PHYS.jumpPadSpeed * pad.power * 0.5) {
      s.vy = PHYS.jumpPadSpeed * pad.power;
      s.coyote = 0;
      s.grounded = false;
      s.jumpsUsed = 1;
      ev.padded = true;
    }
  }
  for (const st of mw.map.strips) {
    if (inZone(st, s.x, s.y, s.z)) {
      const along = s.vx * st.dir[0] + s.vz * st.dir[1];
      if (along < PHYS.speedStripMax) {
        const a = PHYS.speedStripAccel * dt;
        s.vx += st.dir[0] * a;
        s.vz += st.dir[1] * a;
      }
    }
  }

  // Gravity
  if (!s.grounded || s.vy > 0) s.vy -= PHYS.gravity * dt;
  else s.vy = -2; // keep contact with the ground, including down slopes
  if (s.vy < -PHYS.maxFallSpeed) s.vy = -PHYS.maxFallSpeed;

  const wasGrounded = s.grounded;
  const wantX = s.vx * dt;
  const wantZ = s.vz * dt;
  const wantY = s.vy * dt;
  const fallSpeed = s.vy;
  const beforeX = s.x;
  const beforeZ = s.z;
  const beforeY = s.y;
  mw.move(s, dt);
  s.grounded = mw.grounded && s.vy <= 0;

  // Zero out velocity along blocked axes so we don't "stick" pressing a wall.
  const movedX = s.x - beforeX;
  const movedZ = s.z - beforeZ;
  if (Math.abs(wantX) > 1e-4 && Math.abs(movedX) < Math.abs(wantX) * 0.5) s.vx = movedX / dt;
  if (Math.abs(wantZ) > 1e-4 && Math.abs(movedZ) < Math.abs(wantZ) * 0.5) s.vz = movedZ / dt;
  if (wantY > 0 && s.y - beforeY < wantY * 0.5) s.vy = 0;

  if (s.grounded && !wasGrounded) {
    ev.landed = -fallSpeed;
    if (char.bouncy && -fallSpeed > PHYS.jellyBounceMinSpeed) {
      s.vy = -fallSpeed * PHYS.jellyBounce;
      s.grounded = false;
      s.coyote = 0;
      ev.bounced = true;
    }
  }
  return ev;
}

// ---- world construction, shared by client and server --------------------------
export function addPrimCollider(world: RAPIER.World, prim: Prim): RAPIER.Collider | null {
  if (!prim.solid) return null;
  let desc: RAPIER.ColliderDesc;
  switch (prim.shape) {
    case 'box':
      desc = RAPIER.ColliderDesc.cuboid(prim.s[0] / 2, prim.s[1] / 2, prim.s[2] / 2);
      break;
    case 'cyl':
      desc = RAPIER.ColliderDesc.cylinder(prim.s[1] / 2, prim.s[0]);
      break;
    case 'cone':
      desc = RAPIER.ColliderDesc.cone(prim.s[1] / 2, prim.s[0]);
      break;
    case 'sphere':
      desc = RAPIER.ColliderDesc.ball(prim.s[0]);
      break;
  }
  desc.setTranslation(prim.p[0], prim.p[1], prim.p[2]);
  if (prim.q) desc.setRotation({ x: prim.q[0], y: prim.q[1], z: prim.q[2], w: prim.q[3] });
  desc.setCollisionGroups(GROUP_STATIC);
  return world.createCollider(desc);
}

/** Builds the Rapier world with all static level geometry. */
export function buildMapWorld(map: MapDef): MotorWorld {
  const world = new RAPIER.World({ x: 0, y: -PHYS.gravity, z: 0 });
  world.timestep = TICK_DT;
  for (const prim of map.prims) addPrimCollider(world, prim);
  const mw = new MotorWorld(world, map);
  world.step(); // registers colliders with the query pipeline
  return mw;
}

/** Ray from `o` along unit `d` against level geometry. Returns distance or -1. */
export function raycastStatic(mw: MotorWorld, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxDist: number): number {
  const hit = mw.world.castRay(new RAPIER.Ray(o, d), maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, GROUP_STATIC_FILTER, undefined, undefined, (c) => c.handle !== mw.probe.handle);
  return hit ? hit.timeOfImpact : -1;
}

/** Downward ray for the paint surface scan. Same result on client and server. */
export function surfaceRay(mw: MotorWorld, x: number, z: number, startY: number, length: number): { y: number; nx: number; ny: number; nz: number } | null {
  const hit = mw.world.castRayAndGetNormal(new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 }), length, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, GROUP_STATIC_FILTER, undefined, undefined, (c) => c.handle !== mw.probe.handle);
  return hit ? { y: startY - hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z } : null;
}

export function aimDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

export const initPhysics = (): Promise<void> => RAPIER.init();
export { RAPIER };
