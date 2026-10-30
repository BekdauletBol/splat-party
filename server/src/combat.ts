// Weapons, damage, death and respawn. Everything is decided here; clients only
// ever send inputs, so positions, hits and damage can't be forged.
import {
  Btn, COMBAT, DeathCause, GROUP_STATIC_FILTER, HIT_RADIUS, MATCH, NET, PAINT, PHYS, PlayerInput, ProjKind, RAPIER, TICK_DT, TICK_RATE, WEAPONS, WeaponDef, WeaponId,
  aimDirection, distToCapsuleAxis, explosionFalloff, muzzleOf, rayCapsule, raycastStatic,
} from '@splat/shared';
import { Actor } from './actor';
import { ProjectileS } from './schema';
import type { SplatRoom } from './SplatRoom';

interface Projectile {
  s: ProjectileS;
  key: string;
  ttl: number;
  gravity: number;
  radius: number;
  owner: string;
  bounces: boolean;
  stuckTicks: number;
  /** When a plunger sticks to a player we follow that player. */
  stuckOn: string | null;
}

const MAX_REWIND_TICKS = Math.round((NET.maxRewindMs / 1000) * TICK_RATE);
const DEATH_CREDIT_TICKS = 5 * TICK_RATE;

export class Combat {
  private projectiles = new Map<number, Projectile>();
  private nextId = 1;

  constructor(private room: SplatRoom) {}

  reset(): void {
    for (const p of this.projectiles.values()) this.room.state.projectiles.delete(p.key);
    this.projectiles.clear();
  }

  private areEnemies(a: Actor, b: Actor): boolean {
    if (a === b) return false;
    return a.s.team < 0 || a.s.team !== b.s.team;
  }

  private colorOf(a: Actor | undefined): number {
    return a ? this.room.colorOf(a) : 0xffffff;
  }

  // ---- input-driven firing --------------------------------------------------------
  processWeapon(a: Actor, input: PlayerInput): void {
    const s = a.s;
    s.aiming = (input.b & Btn.Aim) !== 0;
    if (!s.alive) {
      s.firing = false;
      return;
    }
    // Weapon selection: fall back to the paint gun if the slot is empty.
    const wanted = input.w as WeaponId;
    const weapon = wanted === WeaponId.Paint || this.ammoOf(a, wanted) > 0 ? wanted : WeaponId.Paint;
    s.weapon = weapon;
    const firing = (input.b & Btn.Fire) !== 0 && a.motor.bubble <= 0 && this.room.canFight();
    s.firing = firing;
    if (!firing || this.room.state.tick < a.cooldown) return;
    const def = WEAPONS[weapon];
    a.cooldown = this.room.state.tick + def.cooldownTicks;
    if (weapon !== WeaponId.Paint) this.setAmmo(a, weapon, this.ammoOf(a, weapon) - 1);
    a.spawnProtect = 0;
    if (def.projectileSpeed > 0) this.fireProjectile(a, def, input);
    else this.fireHitscan(a, def, input);
  }

  ammoOf(a: Actor, w: WeaponId): number {
    return w === WeaponId.Plunger ? a.s.ammo1 : w === WeaponId.Chicken ? a.s.ammo2 : w === WeaponId.Bubble ? a.s.ammo3 : Infinity;
  }
  setAmmo(a: Actor, w: WeaponId, v: number): void {
    if (w === WeaponId.Plunger) a.s.ammo1 = v;
    else if (w === WeaponId.Chicken) a.s.ammo2 = v;
    else if (w === WeaponId.Bubble) a.s.ammo3 = v;
  }

  private spreadDir(input: PlayerInput, spread: number): { x: number; y: number; z: number } {
    const k = input.b & Btn.Aim ? COMBAT.aimSpreadMul : 1;
    const yaw = input.ay + (Math.random() - 0.5) * 2 * spread * k;
    const pitch = input.ap + (Math.random() - 0.5) * 2 * spread * k;
    return aimDirection(yaw, pitch);
  }

  private fireHitscan(a: Actor, def: WeaponDef, input: PlayerInput): void {
    const st = this.room.state;
    const o = muzzleOf(a.motor.x, a.motor.y, a.motor.z, input.y);
    const d = this.spreadDir(input, def.spread * (a.def.spreadMul ?? 1));
    const wallDist = raycastStatic(this.room.mw, o, d, def.range);
    const maxDist = wallDist >= 0 ? wallDist : def.range;
    // Lag compensation: test targets where the shooter saw them, bounded so a
    // laggy (or lying) client can't shoot arbitrarily far into the past.
    const rewindTo = Math.max(st.tick - MAX_REWIND_TICKS, Math.min(st.tick, input.v));
    let bestT = -1;
    let victim: Actor | null = null;
    for (const t of this.room.actors.values()) {
      if (t === a || !t.s.alive || !this.areEnemies(a, t)) continue;
      const past = t.rewound(rewindTo);
      if (!past || !past.alive) continue;
      const hit = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, maxDist, past.x, past.y, past.z);
      if (hit >= 0 && (bestT < 0 || hit < bestT)) {
        bestT = hit;
        victim = t;
      }
    }
    const dist = bestT >= 0 ? bestT : maxDist;
    const tx = o.x + d.x * dist;
    const ty = o.y + d.y * dist;
    const tz = o.z + d.z * dist;
    const color = this.colorOf(a);
    this.room.emit({ t: 'shot', by: a.s.id, weapon: def.id, fx: o.x, fy: o.y, fz: o.z, tx, ty, tz, color, hitWorld: victim === null && wallDist >= 0 });
    if (victim) {
      const k = PHYS.knockbackHitscan * def.knockback * victim.def.knockbackMul;
      victim.motor.vx += d.x * k;
      victim.motor.vz += d.z * k;
      this.damage(victim, def.damage, a, 'paint', tx, ty, tz);
    } else if (wallDist >= 0) {
      this.room.paintAt(a, tx, ty, tz, PAINT.brushHitscan);
    }
  }

  private fireProjectile(a: Actor, def: WeaponDef, input: PlayerInput): void {
    const o = muzzleOf(a.motor.x, a.motor.y, a.motor.z, input.y);
    const d = this.spreadDir(input, def.spread * (a.def.spreadMul ?? 1));
    this.spawnProjectile(a, def.id as unknown as ProjKind, o, d, def.projectileSpeed, def.projectileGravity, def.projectileRadius, def.projectileTtlTicks, false);
    this.room.emit({ t: 'launch', by: a.s.id, weapon: def.id });
  }

  spawnProjectile(a: Actor, kind: ProjKind, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, speed: number, gravity: number, radius: number, ttl: number, bounces: boolean): void {
    const id = this.nextId++ & 0xffff;
    const key = String(id);
    const s = new ProjectileS();
    s.id = id;
    s.kind = kind;
    s.x = o.x;
    s.y = o.y;
    s.z = o.z;
    s.vx = d.x * speed;
    s.vy = d.y * speed;
    s.vz = d.z * speed;
    s.owner = a.s.id;
    this.projectiles.set(id, { s, key, ttl, gravity, radius, owner: a.s.id, bounces, stuckTicks: 0, stuckOn: null });
    this.room.state.projectiles.set(key, s);
  }

  /** Toaster passive: dashing throws a bouncing toast ahead. */
  spawnToast(a: Actor): void {
    const o = { x: a.motor.x + a.motor.dashX, y: a.motor.y + COMBAT.muzzleHeight, z: a.motor.z + a.motor.dashZ };
    const d = { x: a.motor.dashX, y: 0.25, z: a.motor.dashZ };
    const len = Math.hypot(d.x, d.y, d.z);
    this.spawnProjectile(a, ProjKind.Toast, o, { x: d.x / len, y: d.y / len, z: d.z / len }, COMBAT.toastSpeed, COMBAT.toastGravity, COMBAT.toastRadius, COMBAT.toastTtlTicks, true);
  }

  // ---- projectiles ---------------------------------------------------------------
  stepProjectiles(): void {
    for (const p of [...this.projectiles.values()]) this.stepProjectile(p);
  }

  private removeProjectile(p: Projectile): void {
    this.projectiles.delete(p.s.id);
    this.room.state.projectiles.delete(p.key);
  }

  private stepProjectile(p: Projectile): void {
    const s = p.s;
    const owner = this.room.actors.get(p.owner);
    if (s.stuck) {
      if (p.stuckOn) {
        const t = this.room.actors.get(p.stuckOn);
        if (t) {
          s.x = t.motor.x;
          s.y = t.motor.y;
          s.z = t.motor.z;
        }
      }
      if (--p.stuckTicks <= 0) this.removeProjectile(p);
      return;
    }
    if (--p.ttl <= 0) {
      if (s.kind === ProjKind.Chicken) this.explode(s.x, s.y, s.z, WEAPONS[WeaponId.Chicken], owner);
      this.removeProjectile(p);
      return;
    }
    s.vy -= p.gravity * TICK_DT;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    if (speed < 1e-3) return;
    const step = speed * TICK_DT;
    const dir = { x: s.vx / speed, y: s.vy / speed, z: s.vz / speed };

    // Players first: a capsule grown by the projectile's own radius.
    const enemy = this.projectileVictim(p, s, dir, step);
    const hit = this.room.mw.world.castRayAndGetNormal(
      new RAPIER.Ray({ x: s.x, y: s.y, z: s.z }, dir),
      step + p.radius,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      GROUP_STATIC_FILTER,
      undefined,
      undefined,
      (c) => c.handle !== this.room.mw.probe.handle,
    );
    const wallT = hit ? hit.timeOfImpact : Infinity;

    if (enemy && enemy.t <= wallT) {
      s.x += dir.x * enemy.t;
      s.y += dir.y * enemy.t;
      s.z += dir.z * enemy.t;
      this.onHitPlayer(p, enemy.actor, owner, dir);
      return;
    }
    if (hit) {
      const hx = s.x + dir.x * wallT;
      const hy = s.y + dir.y * wallT;
      const hz = s.z + dir.z * wallT;
      if (p.bounces) {
        const n = hit.normal;
        const dot = s.vx * n.x + s.vy * n.y + s.vz * n.z;
        s.vx = (s.vx - 2 * dot * n.x) * COMBAT.toastBounciness;
        s.vy = (s.vy - 2 * dot * n.y) * COMBAT.toastBounciness;
        s.vz = (s.vz - 2 * dot * n.z) * COMBAT.toastBounciness;
        s.x = hx + n.x * (p.radius + 0.02);
        s.y = hy + n.y * (p.radius + 0.02);
        s.z = hz + n.z * (p.radius + 0.02);
        return;
      }
      s.x = hx;
      s.y = hy;
      s.z = hz;
      this.onHitWorld(p, owner);
      return;
    }
    s.x += s.vx * TICK_DT;
    s.y += s.vy * TICK_DT;
    s.z += s.vz * TICK_DT;
    if (s.y < this.room.mw.map.killY) this.removeProjectile(p);
  }

  private projectileVictim(p: Projectile, s: ProjectileS, dir: { x: number; y: number; z: number }, step: number): { actor: Actor; t: number } | null {
    let best: { actor: Actor; t: number } | null = null;
    const owner = this.room.actors.get(p.owner);
    for (const t of this.room.actors.values()) {
      if (!t.s.alive || t.s.id === p.owner) continue;
      if (owner && !this.areEnemies(owner, t)) continue;
      const hit = rayCapsule(s.x, s.y, s.z, dir.x, dir.y, dir.z, step + p.radius, t.motor.x, t.motor.y, t.motor.z, undefined, HIT_RADIUS + p.radius);
      if (hit >= 0 && (!best || hit < best.t)) best = { actor: t, t: hit };
    }
    return best;
  }

  private onHitPlayer(p: Projectile, victim: Actor, owner: Actor | undefined, dir: { x: number; y: number; z: number }): void {
    const s = p.s;
    switch (s.kind as ProjKind) {
      case ProjKind.Chicken:
        this.explode(s.x, s.y, s.z, WEAPONS[WeaponId.Chicken], owner);
        this.removeProjectile(p);
        break;
      case ProjKind.Plunger: {
        this.damage(victim, WEAPONS[WeaponId.Plunger].damage, owner, 'plunger', s.x, s.y, s.z);
        if (owner) {
          owner.stats.plungerHits++;
          if (victim.s.alive) {
            victim.pullTicks = COMBAT.plungerStickTicks;
            victim.pullBy = owner.s.id;
          }
        }
        s.stuck = true;
        s.vx = s.vy = s.vz = 0;
        p.stuckTicks = COMBAT.plungerStickTicks;
        p.stuckOn = victim.s.id;
        this.room.emit({ t: 'stick', x: s.x, y: s.y, z: s.z });
        break;
      }
      case ProjKind.Bubble:
        victim.motor.bubble = COMBAT.bubbleTicks;
        victim.pullTicks = 0;
        this.damage(victim, WEAPONS[WeaponId.Bubble].damage, owner, 'bubble', s.x, s.y, s.z);
        if (owner) owner.stats.bubbleHits++;
        this.room.emit({ t: 'bubble', victim: victim.s.id });
        this.removeProjectile(p);
        break;
      case ProjKind.Toast: {
        const k = PHYS.knockbackHitscan * 4 * victim.def.knockbackMul;
        victim.motor.vx += dir.x * k;
        victim.motor.vz += dir.z * k;
        this.damage(victim, COMBAT.toastDamage, owner, 'toast', s.x, s.y, s.z);
        if (owner) owner.stats.toastHits++;
        this.removeProjectile(p);
        break;
      }
    }
  }

  private onHitWorld(p: Projectile, owner: Actor | undefined): void {
    const s = p.s;
    switch (s.kind as ProjKind) {
      case ProjKind.Chicken:
        this.explode(s.x, s.y, s.z, WEAPONS[WeaponId.Chicken], owner);
        this.removeProjectile(p);
        break;
      case ProjKind.Plunger:
        s.stuck = true;
        s.vx = s.vy = s.vz = 0;
        p.stuckTicks = COMBAT.plungerStickTicks;
        this.room.emit({ t: 'stick', x: s.x, y: s.y, z: s.z });
        if (owner) {
          this.room.paintAt(owner, s.x, s.y, s.z, PAINT.brushPlunger);
          if (owner.s.alive) {
            // Grapple: the shooter gets dragged to the stuck plunger.
            owner.pullTicks = COMBAT.plungerStickTicks;
            owner.pullBy = null;
            owner.px = s.x;
            owner.py = s.y;
            owner.pz = s.z;
          }
        }
        break;
      default:
        if (owner) this.room.paintAt(owner, s.x, s.y, s.z, PAINT.brushBubble);
        this.room.emit({ t: 'stick', x: s.x, y: s.y, z: s.z });
        this.removeProjectile(p);
    }
  }

  explode(x: number, y: number, z: number, def: WeaponDef, owner: Actor | undefined): void {
    const radius = def.explosionRadius;
    this.room.emit({ t: 'boom', x, y, z, radius, color: this.colorOf(owner) });
    if (owner) this.room.paintAt(owner, x, y, z, PAINT.brushExplosion);
    for (const t of this.room.actors.values()) {
      if (!t.s.alive) continue;
      const dist = distToCapsuleAxis(x, y, z, t.motor.x, t.motor.y, t.motor.z);
      const f = explosionFalloff(dist, radius);
      if (f <= 0) continue;
      const self = t === owner;
      if (!self && owner && !this.areEnemies(owner, t)) continue;
      // Direction from the blast with an upward bias: everyone goes flying.
      let dx = t.motor.x - x;
      let dy = t.motor.y - y;
      let dz = t.motor.z - z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy = dy / len + PHYS.knockbackUpBias;
      dz /= len;
      const k = PHYS.knockbackExplosion * f * def.knockback * t.def.knockbackMul * (self ? PHYS.selfExplosionMul : 1);
      t.motor.vx += dx * k;
      t.motor.vy = Math.max(t.motor.vy, 0) + dy * k;
      t.motor.vz += dz * k;
      t.motor.grounded = false;
      t.motor.coyote = 0;
      t.stats.launches++;
      this.room.emitBump(t);
      const dmg = def.damage * f * (self ? COMBAT.selfDamageMul : 1);
      if (dmg >= 1) this.damage(t, dmg, owner, 'chicken', t.motor.x, t.motor.y, t.motor.z);
    }
    this.room.props.explode(x, y, z, radius);
  }

  // ---- damage ------------------------------------------------------------------------
  damage(victim: Actor, amount: number, by: Actor | undefined, cause: DeathCause, x: number, y: number, z: number): void {
    if (!victim.s.alive || !this.room.canFight()) return;
    if (victim.spawnProtect > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    victim.s.hp = Math.max(0, victim.s.hp - dmg);
    victim.stats.damageTaken += dmg;
    if (by && by !== victim) {
      by.stats.damageDealt += dmg;
      victim.lastDamageBy = by.s.id;
      victim.lastDamageTick = this.room.state.tick;
    }
    this.room.emit({ t: 'hit', victim: victim.s.id, by: by ? by.s.id : '', dmg, x, y, z, color: this.colorOf(by) });
    if (victim.s.hp <= 0) this.kill(victim, by, cause);
  }

  kill(victim: Actor, by: Actor | undefined, cause: DeathCause): void {
    if (!victim.s.alive) return;
    const st = this.room.state;
    const m = victim.motor;
    let killer = by && by !== victim ? by : undefined;
    // Knocked off the map: credit whoever hit you last.
    if (!killer && victim.lastDamageBy && st.tick - victim.lastDamageTick < DEATH_CREDIT_TICKS) killer = this.room.actors.get(victim.lastDamageBy);
    victim.s.alive = false;
    victim.s.hp = 0;
    victim.s.deaths++;
    victim.s.firing = false;
    victim.stats.streak = 0;
    victim.respawnTick = st.tick + MATCH.respawnSec * TICK_RATE;
    victim.s.respawnAt = victim.respawnTick;
    victim.pullTicks = 0;
    if (killer) {
      killer.s.kills++;
      killer.stats.streak++;
      killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
      if (cause === 'chicken') killer.stats.chickenKills++;
    }
    if (cause === 'fall') victim.stats.falls++;
    this.room.onKill(victim, killer, cause);
    this.room.paintAt(victim, m.x, m.y, m.z, PAINT.brushDeath, killer);
    this.room.emit({ t: 'kill', victim: victim.s.id, by: killer ? killer.s.id : null, cause, vx: m.vx, vy: m.vy, vz: m.vz });
  }

  respawn(a: Actor): void {
    a.s.alive = true;
    a.s.hp = a.s.maxHp;
    a.s.weapon = WeaponId.Paint;
    a.s.ammo1 = a.s.ammo2 = a.s.ammo3 = 0;
    a.lastDamageBy = null;
    a.spawnProtect = MATCH.spawnProtectTicks;
    this.room.spawn(a);
  }

  // ---- per-tick interactions ------------------------------------------------------
  /** Plunger pulls: overrides velocity while active. */
  applyPull(a: Actor): void {
    if (a.pullTicks <= 0 || !a.s.alive) {
      a.s.plungered = false;
      return;
    }
    a.pullTicks--;
    let tx = a.px;
    let ty = a.py;
    let tz = a.pz;
    if (a.pullBy) {
      const by = this.room.actors.get(a.pullBy);
      if (!by || !by.s.alive) {
        a.pullTicks = 0;
        return;
      }
      tx = by.motor.x;
      ty = by.motor.y;
      tz = by.motor.z;
    }
    const dx = tx - a.motor.x;
    const dy = ty - a.motor.y;
    const dz = tz - a.motor.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < COMBAT.plungerStopDistance) {
      a.pullTicks = 0;
      a.s.plungered = false;
      return;
    }
    a.s.plungered = true;
    a.s.plungerX = tx;
    a.s.plungerY = ty;
    a.s.plungerZ = tz;
    a.motor.vx = (dx / dist) * PHYS.plungerPullSpeed;
    a.motor.vy = (dy / dist) * PHYS.plungerPullSpeed;
    a.motor.vz = (dz / dist) * PHYS.plungerPullSpeed;
    a.motor.grounded = false;
  }

  /** Cactus thorns + soft player separation. */
  stepContacts(): void {
    const list = [...this.room.actors.values()];
    const tick = this.room.state.tick;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.s.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.s.alive) continue;
        const dx = b.motor.x - a.motor.x;
        const dy = b.motor.y - a.motor.y;
        const dz = b.motor.z - a.motor.z;
        if (Math.abs(dy) > COMBAT.overlapRadius * 2) continue;
        const d = Math.hypot(dx, dz);
        if (d > COMBAT.overlapRadius) continue;
        const nx = d > 1e-3 ? dx / d : 1;
        const nz = d > 1e-3 ? dz / d : 0;
        const push = PHYS.playerPushSpeed;
        a.motor.vx -= nx * push * TICK_DT * TICK_RATE * 0.25;
        a.motor.vz -= nz * push * TICK_DT * TICK_RATE * 0.25;
        b.motor.vx += nx * push * TICK_DT * TICK_RATE * 0.25;
        b.motor.vz += nz * push * TICK_DT * TICK_RATE * 0.25;
        if (a.def.thorns && this.areEnemies(a, b)) this.thorn(a, b, tick);
        if (b.def.thorns && this.areEnemies(a, b)) this.thorn(b, a, tick);
      }
    }
  }

  private thorn(cactus: Actor, victim: Actor, tick: number): void {
    const next = cactus.contactCd.get(victim.s.id) ?? 0;
    if (tick < next) return;
    cactus.contactCd.set(victim.s.id, tick + COMBAT.contactHitCooldownTicks);
    this.damage(victim, COMBAT.cactusContactDamage, cactus, 'thorns', victim.motor.x, victim.motor.y, victim.motor.z);
  }
}
