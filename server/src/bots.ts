// Bot brains. A bot has no special powers: each tick it produces a PlayerInput
// that goes through exactly the same path as a human's.
import {
  BOT, BOT_LEVELS, BotDifficulty, Btn, CHARACTER_IDS, MapDef, PlayerInput, WEAPONS, WeaponId, Waypoint, muzzleOf, raycastStatic,
} from '@splat/shared';
import { Actor } from './actor';
import { PlayerS } from './schema';
import type { SplatRoom } from './SplatRoom';

type BotState = 'patrol' | 'chase' | 'retreat' | 'pickup' | 'paint' | 'hill';

export interface BotMind {
  state: BotState;
  target: string | null;
  route: number[];
  waypoint: number;
  goalX: number;
  goalZ: number;
  aimYaw: number;
  aimPitch: number;
  reaction: number;
  stuck: number;
  lastX: number;
  lastZ: number;
  seq: number;
  burst: number;
  strafe: number;
  thinkIn: number;
  retreatUntil: number;
  pickupId: number;
}

function nearestWaypoint(map: MapDef, x: number, y: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  map.waypoints.forEach((w, i) => {
    const d = Math.hypot(w.p[0] - x, (w.p[1] - y) * 2, w.p[2] - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** BFS over the waypoint graph; fewest hops is plenty on maps this small. */
export function findRoute(wps: Waypoint[], from: number, to: number): number[] {
  if (from === to) return [to];
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q];
    for (const l of wps[n].links) {
      if (prev.has(l)) continue;
      prev.set(l, n);
      if (l === to) {
        const route = [to];
        for (let c = n; c !== from; c = prev.get(c) as number) route.unshift(c);
        return route;
      }
      queue.push(l);
    }
  }
  return [from];
}

export class Bots {
  private minds = new Map<string, BotMind>();
  private counter = 0;
  private usedNames = new Set<string>();

  constructor(private room: SplatRoom) {}

  get count(): number {
    return this.minds.size;
  }
  get ids(): string[] {
    return [...this.minds.keys()];
  }

  add(): Actor {
    const s = new PlayerS();
    s.id = `bot${++this.counter}`;
    s.isBot = true;
    s.ready = true;
    s.nick = this.pickName();
    s.char = CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];
    const a = this.room.addActor(s);
    this.minds.set(s.id, this.freshMind(a));
    return a;
  }

  remove(id?: string): string | null {
    const victim = id ?? this.ids[this.ids.length - 1];
    if (!victim) return null;
    const a = this.room.actors.get(victim);
    if (a) this.usedNames.delete(a.s.nick);
    this.minds.delete(victim);
    this.room.removeActor(victim);
    return victim;
  }

  private pickName(): string {
    const free = BOT.names.filter((n) => !this.usedNames.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `Бот ${this.counter}`;
    this.usedNames.add(name);
    return name;
  }

  private freshMind(a: Actor): BotMind {
    return { state: 'patrol', target: null, route: [], waypoint: -1, goalX: a.motor.x, goalZ: a.motor.z, aimYaw: 0, aimPitch: 0, reaction: 0, stuck: 0, lastX: a.motor.x, lastZ: a.motor.z, seq: 0, burst: 0, strafe: 1, thinkIn: 0, retreatUntil: 0, pickupId: -1 };
  }

  /** Runs before the simulation step: queues one input per bot, like a network message would. */
  think(): void {
    const level = BOT_LEVELS[this.room.state.difficulty as BotDifficulty] ?? BOT_LEVELS[1];
    for (const [id, mind] of this.minds) {
      const a = this.room.actors.get(id);
      if (!a) continue;
      if (!a.s.alive) {
        mind.route.length = 0;
        mind.target = null;
        mind.seq++;
        continue;
      }
      a.queue.push(this.decide(a, mind, level));
    }
  }

  private decide(a: Actor, mind: BotMind, level: (typeof BOT_LEVELS)[number]): PlayerInput {
    if (--mind.thinkIn <= 0) {
      mind.thinkIn = BOT.thinkEveryTicks;
      this.updateState(a, mind, level);
    }
    const { x, y, z } = a.motor;
    let b = 0;
    let mx = 0;
    let mz = 0;

    // --- navigation --------------------------------------------------------------
    let goal = this.currentGoal(a, mind);
    const target = mind.target ? this.room.actors.get(mind.target) : undefined;
    const targetDist = target ? Math.hypot(target.motor.x - x, target.motor.z - z) : Infinity;
    const combatStop = mind.state === 'chase' && target && targetDist < BOT.fireRange * 0.4;
    const moveYaw = goal ? Math.atan2(-(goal.x - x), -(goal.z - z)) : mind.aimYaw;
    if (goal && !combatStop) mz = 1;
    if (combatStop) {
      // Circle-strafe rather than standing still.
      mx = mind.strafe;
      if (Math.random() < 0.02) mind.strafe = -mind.strafe;
    }
    if (goal?.jump && a.motor.grounded) b |= Btn.Jump;

    // Ledge check: don't chase people straight off the map (panic-jump sometimes).
    if (mz !== 0 && a.motor.grounded) {
      const fx = x - Math.sin(moveYaw) * BOT.ledgeLookAhead;
      const fz = z - Math.cos(moveYaw) * BOT.ledgeLookAhead;
      if (raycastStatic(this.room.mw, { x: fx, y: y + 1, z: fz }, { x: 0, y: -1, z: 0 }, BOT.ledgeMaxDrop) < 0) {
        mz = 0;
        mx = mind.strafe;
        mind.route.length = 0;
      }
    }

    // Stuck detection: jump, then pick a new route.
    if (Math.hypot(x - mind.lastX, z - mind.lastZ) > BOT.stuckMoveEpsilon) {
      mind.stuck = 0;
      mind.lastX = x;
      mind.lastZ = z;
    } else if (mz !== 0 && ++mind.stuck > BOT.stuckTicks) {
      mind.stuck = 0;
      b |= Btn.Jump;
      mind.route.length = 0;
      mind.waypoint = -1;
      goal = null;
    }
    if (Math.random() < BOT.jumpRandomChance * (level.aggression + 0.5)) b |= Btn.Jump;
    if (Math.random() < BOT.dashChance * level.aggression) b |= Btn.Dash;

    // --- aiming and firing ----------------------------------------------------------
    let weapon = this.chooseWeapon(a, targetDist);
    let wantYaw = mind.aimYaw;
    let wantPitch = mind.aimPitch;
    let fire = false;
    if (target && target.s.alive) {
      const m = muzzleOf(x, y, z, moveYaw);
      const dx = target.motor.x - m.x;
      const dy = target.motor.y - m.y;
      const dz = target.motor.z - m.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (mind.reaction > 0) mind.reaction--;
      else if (targetDist < BOT.fireRange) {
        // Fire in bursts so bots feel like they breathe.
        mind.burst = (mind.burst + 1) % (BOT.fireBurstTicks + BOT.fireRestTicks);
        fire = mind.burst < BOT.fireBurstTicks;
      }
    } else if (mind.state === 'paint') {
      // Spray the floor just ahead while walking.
      wantYaw = moveYaw;
      wantPitch = -0.45;
      fire = true;
      weapon = WeaponId.Paint;
    } else {
      wantYaw = moveYaw;
      wantPitch = 0;
    }
    const dy = Math.atan2(Math.sin(wantYaw - mind.aimYaw), Math.cos(wantYaw - mind.aimYaw));
    mind.aimYaw += dy * level.aimTurn;
    mind.aimPitch += (wantPitch - mind.aimPitch) * level.aimTurn;
    if (fire) b |= Btn.Fire;

    mind.seq++;
    return {
      s: a.s.lastSeq + 1 + a.queue.length,
      mx,
      mz,
      y: combatStop ? wantYaw : moveYaw,
      ay: mind.aimYaw + (Math.random() - 0.5) * level.spread,
      ap: mind.aimPitch + (Math.random() - 0.5) * level.spread,
      b,
      w: weapon,
      v: this.room.state.tick,
    };
  }

  private chooseWeapon(a: Actor, dist: number): WeaponId {
    if (a.s.ammo2 > 0 && dist > BOT.bazookaMinRange && dist < BOT.fireRange) return WeaponId.Chicken;
    if (a.s.ammo3 > 0 && dist < BOT.fireRange * 0.6) return WeaponId.Bubble;
    if (a.s.ammo1 > 0 && dist < BOT.fireRange * 0.8) return WeaponId.Plunger;
    return WeaponId.Paint;
  }

  private updateState(a: Actor, mind: BotMind, level: (typeof BOT_LEVELS)[number]): void {
    const tick = this.room.state.tick;
    const hpFrac = a.s.hp / a.s.maxHp;
    const prevTarget = mind.target;
    const enemy = this.findEnemy(a);
    mind.target = enemy ? enemy.s.id : null;
    if (mind.target && mind.target !== prevTarget) mind.reaction = level.reactionTicks;

    if (hpFrac < level.retreatHp && mind.retreatUntil < tick && enemy) {
      mind.retreatUntil = tick + BOT.healthRetreatCooldownTicks;
    }
    let next: BotState;
    const pickup = this.findPickup(a);
    if (mind.retreatUntil > tick && hpFrac < level.retreatHp * 1.5) next = 'retreat';
    else if (pickup && (!enemy || Math.random() < 1 - level.aggression)) next = 'pickup';
    else if (this.room.state.mode === 'paint' && (!enemy || Math.random() > level.aggression)) next = 'paint';
    else if (this.room.state.mode === 'koth' && (!enemy || Math.random() > level.aggression)) next = 'hill';
    else if (enemy && (level.aggression > 0.4 || hpFrac > 0.5)) next = 'chase';
    else next = 'patrol';

    if (next === 'pickup' && pickup) {
      if (mind.pickupId !== pickup.id) mind.route.length = 0;
      mind.pickupId = pickup.id;
      mind.goalX = pickup.x;
      mind.goalZ = pickup.z;
    }
    if (next !== mind.state) {
      mind.state = next;
      mind.route.length = 0;
    }
  }

  private findEnemy(a: Actor): Actor | null {
    let best: Actor | null = null;
    let bd = BOT.sightRange;
    for (const o of this.room.actors.values()) {
      if (o === a || !o.s.alive) continue;
      if (a.s.team >= 0 && o.s.team === a.s.team) continue;
      const d = Math.hypot(o.motor.x - a.motor.x, o.motor.y - a.motor.y, o.motor.z - a.motor.z);
      if (d >= bd) continue;
      const dir = { x: (o.motor.x - a.motor.x) / d, y: (o.motor.y - a.motor.y) / d, z: (o.motor.z - a.motor.z) / d };
      if (raycastStatic(this.room.mw, { x: a.motor.x, y: a.motor.y, z: a.motor.z }, dir, d) >= 0) continue;
      bd = d;
      best = o;
    }
    return best;
  }

  private findPickup(a: Actor): { id: number; x: number; z: number } | null {
    if (a.s.ammo1 + a.s.ammo2 + a.s.ammo3 > 0) return null;
    let best: { id: number; x: number; z: number } | null = null;
    let bd = BOT.pickupSeekRange;
    for (const p of this.room.pickups) {
      if (!p.s.active) continue;
      const d = Math.hypot(p.s.x - a.motor.x, p.s.z - a.motor.z);
      if (d < bd) {
        bd = d;
        best = { id: p.s.id, x: p.s.x, z: p.s.z };
      }
    }
    return best;
  }

  /** Where to walk right now, following the waypoint graph. */
  private currentGoal(a: Actor, mind: BotMind): { x: number; z: number; jump?: boolean } | null {
    const map = this.room.mw.map;
    const wps = map.waypoints;
    const { x, y, z } = a.motor;
    if (mind.route.length) {
      const w = wps[mind.route[0]];
      if (Math.hypot(w.p[0] - x, w.p[2] - z) < BOT.waypointReach) {
        mind.waypoint = mind.route.shift() as number;
      }
    }
    if (!mind.route.length) {
      const here = nearestWaypoint(map, x, y, z);
      const goalIdx = this.routeGoal(a, mind);
      mind.route = findRoute(wps, here, goalIdx);
    }
    const target = mind.target ? this.room.actors.get(mind.target) : undefined;
    // In sight: walk straight at the target instead of following the graph.
    if (mind.state === 'chase' && target) return { x: target.motor.x, z: target.motor.z };
    if (mind.state === 'pickup' && Math.hypot(mind.goalX - x, mind.goalZ - z) < 10) return { x: mind.goalX, z: mind.goalZ };
    const w = wps[mind.route[0]];
    return w ? { x: w.p[0], z: w.p[2], jump: w.jump || w.p[1] > y + 1.5 } : null;
  }

  private routeGoal(a: Actor, mind: BotMind): number {
    const map = this.room.mw.map;
    const wps = map.waypoints;
    const rnd = (): number => Math.floor(Math.random() * wps.length);
    switch (mind.state) {
      case 'retreat': {
        // Run to the waypoint farthest from whoever threatens us.
        const t = mind.target ? this.room.actors.get(mind.target) : undefined;
        if (!t) return rnd();
        let best = 0;
        let bd = -1;
        wps.forEach((w, i) => {
          const d = Math.hypot(w.p[0] - t.motor.x, w.p[2] - t.motor.z);
          if (d > bd) {
            bd = d;
            best = i;
          }
        });
        return best;
      }
      case 'pickup':
        return nearestWaypoint(map, mind.goalX, a.motor.y, mind.goalZ);
      case 'hill':
        return nearestWaypoint(map, map.hill.p[0], map.hill.p[1], map.hill.p[2]);
      case 'paint': {
        const cell = this.room.paintGoalFor(a);
        return cell ? nearestWaypoint(map, cell.x, a.motor.y, cell.z) : rnd();
      }
      case 'chase': {
        const t = mind.target ? this.room.actors.get(mind.target) : undefined;
        return t ? nearestWaypoint(map, t.motor.x, t.motor.y, t.motor.z) : rnd();
      }
      default:
        return rnd();
    }
  }
}

export const botWeaponName = (w: WeaponId): string => WEAPONS[w].name;
