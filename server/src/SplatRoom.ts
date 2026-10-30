import { Client, Room } from 'colyseus';
import {
  ALLOW_TUNE_ENV, CHARACTERS, CHARACTER_IDS, COMBAT, CharacterId, DEFAULT_MAP, DeathCause, FFA_COLORS, GameEvent, PickupSpawn, TEAM_COLORS, WEAPONS, JoinOptions, MAPS, MATCH, MSG, MotorEvents, MotorWorld, NET, PHYS, PlayerInput,
  TICK_RATE, buildMapWorld, isPhysKey, makeMotorState, stepMotor,
} from '@splat/shared';
import { Actor } from './actor';
import { Bots } from './bots';
import { Combat } from './combat';
import { Props } from './props';
import { GameState, PickupS, PlayerS } from './schema';

const usedCodes = new Set<string>();
function makeCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < MATCH.codeLength; i++) code += MATCH.codeAlphabet[Math.floor(Math.random() * MATCH.codeAlphabet.length)];
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
}

const clampNum = (v: unknown, min: number, max: number, dflt = 0): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return n < min ? min : n > max ? max : n;
};

function sanitizeNick(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[<>&"']/g, '').trim().slice(0, MATCH.maxNickLength) : '';
  return s || `Игрок${Math.floor(Math.random() * 900 + 100)}`;
}

export class SplatRoom extends Room<GameState> {
  maxClients = MATCH.maxPlayers;
  state = new GameState();
  mw!: MotorWorld;
  actors = new Map<string, Actor>();
  spawnCursor = 0;
  combat!: Combat;
  bots!: Bots;
  props!: Props;
  pickups: { s: PickupS; def: PickupSpawn; respawnTick: number }[] = [];

  onCreate(options: JoinOptions): void {
    this.roomId = makeCode();
    const st = this.state;
    st.code = this.roomId;
    st.map = options.map && MAPS[options.map] ? options.map : DEFAULT_MAP;
    this.mw = buildMapWorld(MAPS[st.map]);
    this.combat = new Combat(this);
    this.bots = new Bots(this);
    st.botCount = clampNum(options.bots, 0, MATCH.maxPlayers - 1, MATCH.defaultBots) | 0;
    st.difficulty = clampNum(options.difficulty, 0, 2, 1) | 0;
    st.maxPlayers = clampNum(options.maxPlayers, MATCH.minPlayers, MATCH.maxPlayers, MATCH.maxPlayers) | 0;
    this.maxClients = st.maxPlayers;
    this.props = new Props(this, this.mw.map);
    this.mw.map.pickups.forEach((def, i) => {
      const s = new PickupS();
      s.id = i + 1;
      s.weapon = def.weapon;
      [s.x, s.y, s.z] = def.p;
      st.pickups.set(String(s.id), s);
      this.pickups.push({ s, def, respawnTick: 0 });
    });
    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);

    this.onMessage(MSG.Input, (client, data) => this.onInputs(client, data));
    this.onMessage(MSG.Start, () => {}); // lobby flow arrives with the modes milestone
    this.onMessage(MSG.Tune, (client, data: { key: string; value: number }) => this.onTune(client, data));
  }

  onJoin(client: Client, options: JoinOptions): void {
    const s = new PlayerS();
    s.id = client.sessionId;
    s.nick = sanitizeNick(options.nick);
    s.char = CHARACTER_IDS.includes(options.char as CharacterId) ? (options.char as string) : 'pelmen';
    this.addActor(s);
    if (!this.state.host) this.state.host = client.sessionId;
    this.balanceBots();
    client.send(MSG.Tuned, { ...PHYS });
  }

  onLeave(client: Client): void {
    this.removeActor(client.sessionId);
    if (this.state.host === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.host = next ? next.sessionId : '';
    }
    this.balanceBots();
  }

  onDispose(): void {
    usedCodes.delete(this.state.code);
    this.mw.world.free();
  }

  addActor(s: PlayerS): Actor {
    const a = new Actor(s);
    s.maxHp = CHARACTERS[a.charId].hp;
    s.hp = s.maxHp;
    this.actors.set(s.id, a);
    this.state.players.set(s.id, s);
    this.spawn(a);
    return a;
  }

  removeActor(id: string): void {
    this.actors.delete(id);
    this.state.players.delete(id);
  }

  spawn(a: Actor): void {
    const spawns = this.mw.map.spawns;
    let best = spawns[this.spawnCursor++ % spawns.length];
    let bestScore = -1;
    for (const p of spawns) {
      let near = Infinity;
      for (const o of this.actors.values()) {
        if (o === a || !o.s.alive) continue;
        near = Math.min(near, Math.hypot(o.motor.x - p[0], o.motor.z - p[2]));
      }
      const score = near + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    a.motor = makeMotorState(best[0], best[1], best[2]);
    a.s.teleport = (a.s.teleport + 1) % 250;
    a.queue.length = 0;
    a.sync();
  }

  onInputs(client: Client, data: unknown): void {
    const a = this.actors.get(client.sessionId);
    if (!a || !Array.isArray(data)) return;
    for (const raw of data as Partial<PlayerInput>[]) {
      if (!raw || typeof raw.s !== 'number' || !Number.isFinite(raw.s)) continue;
      const last = a.queue.length ? a.queue[a.queue.length - 1].s : a.s.lastSeq;
      if (raw.s <= last) continue; // redundant copy
      if (a.queue.length >= NET.maxPendingInputs) a.queue.shift();
      a.queue.push({
        s: raw.s,
        mx: clampNum(raw.mx, -1, 1),
        mz: clampNum(raw.mz, -1, 1),
        y: clampNum(raw.y, -1e6, 1e6),
        ay: clampNum(raw.ay, -1e6, 1e6),
        ap: clampNum(raw.ap, -Math.PI / 2, Math.PI / 2),
        b: clampNum(raw.b, 0, 255) | 0,
        w: clampNum(raw.w, 0, 3) | 0,
        v: clampNum(raw.v, 0, 2 ** 31),
      });
    }
  }

  onTune(_client: Client, data: { key: string; value: number }): void {
    // Dev panel: live in dev, off in production unless explicitly allowed.
    if (process.env.NODE_ENV === 'production' && !process.env[ALLOW_TUNE_ENV]) return;
    if (!data || !isPhysKey(data.key) || !Number.isFinite(data.value)) return;
    PHYS[data.key] = data.value;
    this.broadcast(MSG.Tuned, { [data.key]: data.value });
  }

  emit(ev: GameEvent): void {
    this.broadcast(MSG.Event, ev);
  }

  /** Bots fill the empty slots: a human joining pushes one out, and vice versa. */
  balanceBots(): void {
    const humans = [...this.actors.values()].filter((a) => !a.s.isBot).length;
    if (humans === 0) return;
    const wanted = Math.max(0, Math.min(this.state.botCount, this.state.maxPlayers - humans));
    while (this.bots.count < wanted) {
      const a = this.bots.add();
      this.emit({ t: 'botjoin', nick: a.s.nick });
    }
    while (this.bots.count > wanted) {
      const id = this.bots.ids[this.bots.count - 1];
      const nick = this.actors.get(id)?.s.nick ?? '';
      this.bots.remove(id);
      this.emit({ t: 'botleave', nick });
    }
  }

  paintGoalFor(_a: Actor): { x: number; z: number } | null {
    return null;
  }

  colorOf(a: Actor): number {
    if (a.s.team >= 0) return TEAM_COLORS[a.s.team];
    let h = 0;
    for (let i = 0; i < a.s.id.length; i++) h = (h * 31 + a.s.id.charCodeAt(i)) | 0;
    return FFA_COLORS[Math.abs(h) % FFA_COLORS.length];
  }

  canFight(): boolean {
    return true;
  }

  // Filled in with the paint mode.
  paintAt(_a: Actor, _x: number, _y: number, _z: number, _radius: number, _killer?: Actor): void {}

  onKill(_victim: Actor, killer: Actor | undefined, _cause: DeathCause): void {
    if (killer) killer.s.score = killer.s.kills;
  }

  emitBump(a: Actor): void {
    this.emit({ t: 'bump', id: a.s.id, x: a.motor.x, y: a.motor.y, z: a.motor.z });
  }

  tick(): void {
    const st = this.state;
    st.tick++;
    this.bots.think();
    this.props.step();
    this.mw.world.step();
    this.combat.stepProjectiles();
    for (const a of this.actors.values()) {
      if (a.s.alive) {
        this.combat.applyPull(a);
        this.stepActor(a);
        if (a.motor.y < this.mw.map.killY) this.combat.kill(a, undefined, 'fall');
      } else {
        // Dead: drain inputs so acks keep flowing, and wait for the respawn.
        if (a.queue.length) {
          a.s.lastSeq = a.queue[a.queue.length - 1].s;
          a.lastInput = a.queue[a.queue.length - 1];
          a.queue.length = 0;
        }
        if (st.tick >= a.respawnTick) this.combat.respawn(a);
      }
      a.record(st.tick);
    }
    this.combat.stepContacts();
    this.stepPickups();
  }

  stepActor(a: Actor): void {
    if (a.spawnProtect > 0) a.spawnProtect--;
    // Token bucket: inputs are capped at real time (plus a little slack), so a
    // late burst can catch up but a speed hack can't get ahead.
    a.budget = Math.min(NET.inputBudgetCap, a.budget + NET.inputBudgetPerTick);
    let stepped = 0;
    while (a.queue.length && a.budget >= 1 && stepped < NET.maxInputsPerTick) {
      const input = a.queue.shift() as PlayerInput;
      a.budget -= 1;
      stepped++;
      this.applyInput(a, input);
    }
    if (stepped) a.idleTicks = 0;
    else if (++a.idleTicks > NET.idleTicksBeforeAutoStep) {
      // Client went quiet (hidden tab, stall): physics keep acting on it.
      this.afterMotor(a, stepMotor(a.motor, { mx: 0, mz: 0, y: a.lastInput.y, b: 0 }, a.charId, this.mw));
    }
    if (!a.motor.grounded) a.stats.airTicks++;
    a.sync();
  }

  applyInput(a: Actor, input: PlayerInput): void {
    a.lastInput = input;
    a.s.lastSeq = input.s;
    a.s.yaw = input.y;
    a.s.ay = input.ay;
    a.s.ap = input.ap;
    this.afterMotor(a, stepMotor(a.motor, input, a.charId, this.mw));
    this.combat.processWeapon(a, input);
  }

  private afterMotor(a: Actor, ev: MotorEvents): void {
    if (ev.dashed && a.def.toastDash) this.combat.spawnToast(a);
    const id = a.s.id;
    if (ev.jumped) this.emit({ t: 'motor', id, kind: 'jump', v: 0 });
    if (ev.doubleJumped) this.emit({ t: 'motor', id, kind: 'djump', v: 0 });
    if (ev.dashed) this.emit({ t: 'motor', id, kind: 'dash', v: 0 });
    if (ev.padded) this.emit({ t: 'motor', id, kind: 'pad', v: 0 });
    if (ev.bounced) this.emit({ t: 'motor', id, kind: 'bounce', v: ev.landed });
    else if (ev.landed > COMBAT.landEventMinSpeed) this.emit({ t: 'motor', id, kind: 'land', v: ev.landed });
  }

  stepPickups(): void {
    const tick = this.state.tick;
    for (const p of this.pickups) {
      if (!p.s.active) {
        if (tick >= p.respawnTick) p.s.active = true;
        continue;
      }
      for (const a of this.actors.values()) {
        if (!a.s.alive) continue;
        if (Math.hypot(a.motor.x - p.s.x, a.motor.y - p.s.y, a.motor.z - p.s.z) > COMBAT.pickupRadius) continue;
        const w = p.s.weapon;
        this.combat.setAmmo(a, w, Math.min(COMBAT.maxAmmo, this.combat.ammoOf(a, w) + WEAPONS[w].pickupAmmo));
        p.s.active = false;
        p.respawnTick = tick + COMBAT.pickupRespawnSec * TICK_RATE;
        this.emit({ t: 'pickup', id: a.s.id, weapon: w });
        break;
      }
    }
  }
}
