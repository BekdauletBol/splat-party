import { Client, Room } from 'colyseus';
import {
  ALLOW_TUNE_ENV, CHARACTERS, CHARACTER_IDS, CharacterId, DEFAULT_MAP, GameEvent, JoinOptions, MAPS, MATCH, MSG, MotorWorld, NET, PHYS, PlayerInput,
  TICK_RATE, buildMapWorld, isPhysKey, makeMotorState, stepMotor,
} from '@splat/shared';
import { Actor } from './actor';
import { GameState, PlayerS } from './schema';

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

  onCreate(options: JoinOptions): void {
    this.roomId = makeCode();
    const st = this.state;
    st.code = this.roomId;
    st.map = options.map && MAPS[options.map] ? options.map : DEFAULT_MAP;
    this.mw = buildMapWorld(MAPS[st.map]);
    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);

    this.onMessage(MSG.Input, (client, data) => this.onInputs(client, data));
    this.onMessage(MSG.Tune, (client, data: { key: string; value: number }) => this.onTune(client, data));
  }

  onJoin(client: Client, options: JoinOptions): void {
    const s = new PlayerS();
    s.id = client.sessionId;
    s.nick = sanitizeNick(options.nick);
    s.char = CHARACTER_IDS.includes(options.char as CharacterId) ? (options.char as string) : 'pelmen';
    this.addActor(s);
    if (!this.state.host) this.state.host = client.sessionId;
    client.send(MSG.Tuned, { ...PHYS });
  }

  onLeave(client: Client): void {
    this.removeActor(client.sessionId);
    if (this.state.host === client.sessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.host = next ? next.sessionId : '';
    }
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

  tick(): void {
    const st = this.state;
    st.tick++;
    for (const a of this.actors.values()) this.stepActor(a);
  }

  stepActor(a: Actor): void {
    // Token bucket: one input per tick on average; a late burst may catch up but
    // can never exceed real time, which rules out speed hacks.
    a.budget = Math.min(NET.inputBudgetCap, a.budget + NET.inputBudgetPerTick);
    let stepped = 0;
    while (a.queue.length && a.budget >= 1 && stepped < NET.maxInputsPerTick) {
      const input = a.queue.shift() as PlayerInput;
      a.budget -= 1;
      stepped++;
      a.lastInput = input;
      a.s.lastSeq = input.s;
      a.s.yaw = input.y;
      a.s.ay = input.ay;
      a.s.ap = input.ap;
      stepMotor(a.motor, input, a.charId, this.mw);
    }
    if (stepped) a.idleTicks = 0;
    else if (++a.idleTicks > NET.idleTicksBeforeAutoStep) {
      // Client went quiet (hidden tab, stall): physics keep acting on it.
      stepMotor(a.motor, { mx: 0, mz: 0, y: a.lastInput.y, b: 0 }, a.charId, this.mw);
    }
    if (a.motor.y < this.mw.map.killY) this.spawn(a);
    a.sync();
    a.record(this.state.tick);
  }
}
