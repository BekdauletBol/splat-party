// Rolling balls and crates: real Rapier dynamic bodies that shove players around.
import { GROUP_PROP, MapDef, PHYS, PROPS, PropSpawn, RAPIER } from '@splat/shared';
import { PropS } from './schema';
import type { SplatRoom } from './SplatRoom';

interface Prop {
  s: PropS;
  body: RAPIER.RigidBody;
  spawn: PropSpawn;
  bumpCd: Map<string, number>;
}

export class Props {
  private list: Prop[] = [];
  private nextKick: number = PROPS.kickEveryTicks;

  constructor(private room: SplatRoom, private map: MapDef) {
    map.props.forEach((spawn, i) => this.create(spawn, i + 1));
  }

  private create(spawn: PropSpawn, id: number): void {
    const world = this.room.mw.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.p[0], spawn.p[1], spawn.p[2])
        .setLinearDamping(PROPS.linearDamping)
        .setAngularDamping(PROPS.angularDamping)
        .setCanSleep(false),
    );
    const collider = spawn.kind === 'ball' ? RAPIER.ColliderDesc.ball(spawn.radius) : RAPIER.ColliderDesc.cuboid(spawn.radius, spawn.radius, spawn.radius);
    collider.setFriction(PROPS.friction).setRestitution(PROPS.restitution).setDensity(PROPS.density).setCollisionGroups(GROUP_PROP);
    world.createCollider(collider, body);
    const s = new PropS();
    s.id = id;
    s.kind = spawn.kind;
    s.radius = spawn.radius;
    s.color = spawn.color;
    this.room.state.props.set(String(id), s);
    this.list.push({ s, body, spawn, bumpCd: new Map() });
    this.sync(this.list[this.list.length - 1]);
  }

  private sync(p: Prop): void {
    const t = p.body.translation();
    const q = p.body.rotation();
    p.s.x = t.x;
    p.s.y = t.y;
    p.s.z = t.z;
    p.s.qx = q.x;
    p.s.qy = q.y;
    p.s.qz = q.z;
    p.s.qw = q.w;
  }

  step(): void {
    const tick = this.room.state.tick;
    if (tick >= this.nextKick) {
      // Random nudges keep the balls rolling around for the whole match.
      this.nextKick = tick + PROPS.kickEveryTicks;
      for (const p of this.list) {
        const a = Math.random() * Math.PI * 2;
        p.body.setLinvel({ x: Math.cos(a) * PROPS.kickSpeed, y: 1, z: Math.sin(a) * PROPS.kickSpeed }, true);
      }
    }
    for (const p of this.list) {
      const t = p.body.translation();
      if (t.y < this.map.killY - PROPS.respawnBelowMargin) {
        p.body.setTranslation({ x: p.spawn.p[0], y: p.spawn.p[1], z: p.spawn.p[2] }, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      this.bumpPlayers(p, tick);
      this.sync(p);
    }
  }

  private bumpPlayers(p: Prop, tick: number): void {
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = p.spawn.radius;
    for (const a of this.room.actors.values()) {
      if (!a.s.alive) continue;
      const dx = a.motor.x - t.x;
      const dy = a.motor.y - t.y;
      const dz = a.motor.z - t.z;
      const reach = r + 0.75;
      const d = Math.hypot(dx, dy, dz);
      if (d > reach || d < 1e-3) continue;
      const next = p.bumpCd.get(a.s.id) ?? 0;
      if (tick < next) continue;
      p.bumpCd.set(a.s.id, tick + PROPS.bumpCooldownTicks);
      const ballSpeed = Math.hypot(v.x, v.y, v.z);
      const k = (PHYS.propBumpSpeed + ballSpeed) * a.def.knockbackMul;
      a.motor.vx += (dx / d) * k;
      a.motor.vz += (dz / d) * k;
      a.motor.vy = Math.max(a.motor.vy, 0) + PHYS.propBumpSpeed * 0.4 * a.def.knockbackMul;
      a.motor.grounded = false;
      a.stats.launches++;
      // Players push back: the ball goes the other way.
      p.body.applyImpulse({ x: (-dx / d) * PHYS.propImpulse, y: PHYS.propImpulse * 0.2, z: (-dz / d) * PHYS.propImpulse }, true);
      this.room.emitBump(a);
    }
  }

  explode(x: number, y: number, z: number, radius: number): void {
    for (const p of this.list) {
      const t = p.body.translation();
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius * 1.5 || d < 1e-3) continue;
      const k = (PHYS.knockbackExplosion * (1 - d / (radius * 1.5)) * p.body.mass()) / 2;
      p.body.applyImpulse({ x: (dx / d) * k, y: (dy / d) * k + k * PHYS.knockbackUpBias, z: (dz / d) * k }, true);
    }
  }

  dispose(): void {
    for (const p of this.list) this.room.state.props.delete(String(p.s.id));
    this.list.length = 0;
  }
}
