import { Client, Room } from 'colyseus';
import {
  ALLOW_TUNE_ENV, BOT, CHARACTERS, CHARACTER_IDS, COMBAT, CharacterId, DEFAULT_MAP, DeathCause, FFA_COLORS, GameEvent, JoinOptions, MAPS, MATCH, MODES, MODE_IDS, MSG, MatchResults, ModeId, MotorEvents, MotorWorld, NET, PAINT, PHYS, PaintGrid, PlayerInput,
  TEAM_COLORS, TICK_RATE, WEAPONS, buildMapWorld, computeAwards, evaluateHill, isPhysKey, makeMotorState, scoreLimitReached, stepMotor, surfaceRay, winningTeam,
} from '@splat/shared';
import { Actor, emptyStats } from './actor';
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
  pickups: { s: PickupS; respawnTick: number }[] = [];
  paint: PaintGrid | null = null;
  private paintOut: number[] = [];
  private secondAcc = 0;
  private phaseTimer = 0;

  onCreate(options: JoinOptions): void {
    this.roomId = makeCode();
    const st = this.state;
    st.code = this.roomId;
    st.mode = MODE_IDS.includes(options.mode as ModeId) ? (options.mode as string) : 'ffa';
    st.map = options.map && MAPS[options.map] ? options.map : DEFAULT_MAP;
    st.botCount = clampNum(options.bots, 0, MATCH.maxPlayers - 1, MATCH.defaultBots) | 0;
    st.difficulty = clampNum(options.difficulty, 0, 2, 1) | 0;
    st.maxPlayers = clampNum(options.maxPlayers, MATCH.minPlayers, MATCH.maxPlayers, MATCH.maxPlayers) | 0;
    st.quick = options.quick === true;
    st.isPrivate = options.isPrivate === true;
    this.maxClients = st.maxPlayers;
    if (st.isPrivate) void this.setPrivate(true);
    this.combat = new Combat(this);
    this.bots = new Bots(this);
    this.loadMap(st.map);
    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);

    this.onMessage(MSG.Input, (client, data) => this.onInputs(client, data));
    this.onMessage(MSG.Tune, (client, data: { key: string; value: number }) => this.onTune(client, data));
    this.onMessage(MSG.Ready, (client) => {
      const a = this.actors.get(client.sessionId);
      if (a && st.phase === 'lobby') a.s.ready = !a.s.ready;
    });
    this.onMessage(MSG.SetChar, (client, char: string) => {
      const a = this.actors.get(client.sessionId);
      if (a && st.phase === 'lobby' && CHARACTER_IDS.includes(char as CharacterId)) this.setChar(a, char as CharacterId);
    });
    this.onMessage(MSG.Settings, (client, data: JoinOptions) => {
      if (client.sessionId === st.host && st.phase === 'lobby') this.applySettings(data ?? {});
    });
    this.onMessage(MSG.Start, (client) => {
      if (client.sessionId === st.host && st.phase === 'lobby' && this.allReady()) this.startMatch();
    });
    this.onMessage(MSG.Again, (client) => {
      if (client.sessionId === st.host && st.phase === 'results') this.toLobby();
    });

    if (st.quick) this.phaseTimer = MATCH.quickStartDelaySec * TICK_RATE;
  }

  private allReady(): boolean {
    for (const a of this.actors.values()) if (!a.s.ready && a.s.id !== this.state.host) return false;
    return true;
  }

  private setChar(a: Actor, char: CharacterId): void {
    a.s.char = char;
    a.s.maxHp = CHARACTERS[char].hp;
    a.s.hp = a.s.maxHp;
  }

  private applySettings(d: JoinOptions): void {
    const st = this.state;
    if (MODE_IDS.includes(d.mode as ModeId)) st.mode = d.mode as string;
    if (d.map && MAPS[d.map] && d.map !== st.map) {
      st.map = d.map;
      this.loadMap(d.map);
    }
    if (d.maxPlayers !== undefined) {
      st.maxPlayers = Math.max(this.clients.length, clampNum(d.maxPlayers, MATCH.minPlayers, MATCH.maxPlayers, st.maxPlayers) | 0);
      this.maxClients = st.maxPlayers;
    }
    if (d.bots !== undefined) st.botCount = clampNum(d.bots, 0, MATCH.maxPlayers - 1, st.botCount) | 0;
    if (d.difficulty !== undefined) st.difficulty = clampNum(d.difficulty, 0, 2, st.difficulty) | 0;
    if (d.isPrivate !== undefined) {
      st.isPrivate = d.isPrivate === true;
      void this.setPrivate(st.isPrivate);
    }
    this.balanceBots();
  }

  private loadMap(id: string): void {
    if (this.mw) {
      this.props.dispose();
      this.mw.world.free();
    }
    this.combat.reset();
    this.state.pickups.clear();
    this.pickups = [];
    this.mw = buildMapWorld(MAPS[id]);
    this.props = new Props(this, this.mw.map);
    this.mw.map.pickups.forEach((def, i) => {
      const s = new PickupS();
      s.id = i + 1;
      s.weapon = def.weapon;
      [s.x, s.y, s.z] = def.p;
      this.state.pickups.set(String(s.id), s);
      this.pickups.push({ s, respawnTick: 0 });
    });
    const grid = new PaintGrid(this.mw.map.bounds);
    grid.scan((x, z) => surfaceRay(this.mw, x, z, PAINT.rayStartY, PAINT.rayLength));
    this.paint = grid;
    this.state.paintTotal = grid.paintable;
  }

  onJoin(client: Client, options: JoinOptions): void {
    const st = this.state;
    const s = new PlayerS();
    s.id = client.sessionId;
    s.nick = sanitizeNick(options.nick);
    s.char = CHARACTER_IDS.includes(options.char as CharacterId) ? (options.char as string) : 'pelmen';
    s.team = MODES[st.mode as ModeId].teams ? this.smallestTeam() : -1;
    const midMatch = st.phase === 'playing' || st.phase === 'countdown';
    const a = this.addActor(s);
    if (midMatch) a.spawnProtect = MATCH.spawnProtectTicks;
    if (!st.host) st.host = client.sessionId;
    this.balanceBots();
    client.send(MSG.Tuned, { ...PHYS });
    if (this.paint && st.mode === 'paint') client.send(MSG.PaintFull, Array.from(this.paint.cells));
  }

  onLeave(client: Client): void {
    this.removeActor(client.sessionId);
    const st = this.state;
    if (st.host === client.sessionId) {
      // Host migration: next connected player takes over.
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      st.host = next ? next.sessionId : '';
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

  private smallestTeam(): number {
    let a = 0;
    let b = 0;
    for (const x of this.actors.values()) {
      if (x.s.team === 0) a++;
      else if (x.s.team === 1) b++;
    }
    return a <= b ? 0 : 1;
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
      if (near === Infinity) near = 30;
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
    const phase = this.state.phase;
    if (!a || !Array.isArray(data)) return;
    if (phase === 'lobby' || phase === 'results') {
      // Acknowledge so the client's pending list doesn't grow; nothing is simulated.
      const last = data[data.length - 1] as Partial<PlayerInput>;
      if (typeof last?.s === 'number' && Number.isFinite(last.s) && last.s > a.s.lastSeq) a.s.lastSeq = last.s;
      return;
    }
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
    const teams = MODES[this.state.mode as ModeId].teams;
    while (this.bots.count < wanted) {
      const a = this.bots.add();
      a.s.team = teams ? this.smallestTeam() : -1;
      this.emit({ t: 'botjoin', nick: a.s.nick });
    }
    while (this.bots.count > wanted) {
      const id = this.bots.ids[this.bots.count - 1];
      const nick = this.actors.get(id)?.s.nick ?? '';
      this.bots.remove(id);
      this.emit({ t: 'botleave', nick });
    }
  }

  // ---- match flow ------------------------------------------------------------------
  startMatch(): void {
    const st = this.state;
    const teams = MODES[st.mode as ModeId].teams;
    this.combat.reset();
    this.paint?.clear();
    this.paintOut.length = 0;
    this.broadcast(MSG.PaintFull, []);
    st.scoreA = st.scoreB = 0;
    st.hillOwner = -1;
    st.hillContested = false;
    st.timeLeft = MATCH.durationSec;
    st.countdown = MATCH.countdownSec;
    this.secondAcc = 0;
    this.phaseTimer = 0;
    // Balanced teams: shuffle, then alternate.
    const list = [...this.actors.values()].sort(() => Math.random() - 0.5);
    list.forEach((a, i) => {
      a.s.team = teams ? i % 2 : -1;
      a.s.kills = a.s.deaths = a.s.score = 0;
      a.stats = emptyStats();
      a.s.alive = true;
      a.s.hp = a.s.maxHp;
      a.s.ammo1 = a.s.ammo2 = a.s.ammo3 = 0;
      a.s.weapon = 0;
      a.pullTicks = 0;
      a.lastDamageBy = null;
      a.history.length = 0;
      this.spawn(a);
    });
    for (const p of this.pickups) p.s.active = true;
    st.phase = 'countdown';
    this.emit({ t: 'matchstart' });
  }

  endMatch(): void {
    const st = this.state;
    if (st.phase !== 'playing') return;
    st.phase = 'results';
    const mode = st.mode as ModeId;
    const list = [...this.actors.values()];
    const rows = list
      .map((a) => ({ id: a.s.id, nick: a.s.nick, char: a.s.char, team: a.s.team, isBot: a.s.isBot, kills: a.s.kills, deaths: a.s.deaths, score: a.s.score }))
      .sort((x, y) => y.score - x.score || y.kills - x.kills);
    const awards = computeAwards(list.map((a) => ({ nick: a.s.nick, ...a.stats })));
    const results: MatchResults = {
      mode,
      winnerTeam: MODES[mode].teams ? winningTeam(st.scoreA, st.scoreB) : -1,
      winnerId: MODES[mode].teams ? null : (rows[0]?.id ?? null),
      scoreA: st.scoreA,
      scoreB: st.scoreB,
      rows,
      awards,
    };
    this.broadcast(MSG.Results, results);
    for (const a of list) a.s.firing = false;
    if (st.quick) this.phaseTimer = MATCH.quickRestartDelaySec * TICK_RATE;
  }

  toLobby(): void {
    const st = this.state;
    st.phase = 'lobby';
    for (const a of this.actors.values()) if (!a.s.isBot) a.s.ready = false;
    this.combat.reset();
  }

  colorOf(a: Actor): number {
    if (a.s.team >= 0) return TEAM_COLORS[a.s.team];
    let h = 0;
    for (let i = 0; i < a.s.id.length; i++) h = (h * 31 + a.s.id.charCodeAt(i)) | 0;
    return FFA_COLORS[Math.abs(h) % FFA_COLORS.length];
  }

  canFight(): boolean {
    return this.state.phase === 'playing';
  }

  paintAt(a: Actor, x: number, y: number, z: number, radius: number, killer?: Actor): void {
    if (this.state.mode !== 'paint' || !this.paint || !this.canFight()) return;
    const painter = killer ?? a;
    if (painter.s.team < 0) return;
    const before = this.paintOut.length;
    this.paint.brush(x, y, z, radius, painter.s.team, this.paintOut);
    const added = this.paintOut.length - before;
    painter.stats.paintCells += added;
    painter.s.score += added;
  }

  /** A nearby cell not yet in the bot's team color, for the bot's paint route. */
  paintGoalFor(a: Actor): { x: number; z: number } | null {
    const g = this.paint;
    if (!g) return null;
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (let i = 0; i < BOT.paintScanCells; i++) {
      const c = Math.floor(Math.random() * g.cols);
      const r = Math.floor(Math.random() * g.rows);
      const idx = c + r * g.cols;
      if (Number.isNaN(g.surface[idx]) || g.cells[idx] === a.s.team) continue;
      const x = g.cellX(c);
      const z = g.cellZ(r);
      const d = Math.hypot(x - a.motor.x, z - a.motor.z);
      if (d < bd) {
        bd = d;
        best = { x, z };
      }
    }
    return best;
  }

  onKill(_victim: Actor, killer: Actor | undefined, _cause: DeathCause): void {
    if (!killer) return;
    const mode = this.state.mode;
    if (mode === 'ffa' || mode === 'tdm') killer.s.score = killer.s.kills;
    if (mode === 'tdm') {
      if (killer.s.team === 0) this.state.scoreA++;
      else if (killer.s.team === 1) this.state.scoreB++;
    }
  }

  emitBump(a: Actor): void {
    this.emit({ t: 'bump', id: a.s.id, x: a.motor.x, y: a.motor.y, z: a.motor.z });
  }

  tick(): void {
    const st = this.state;
    st.tick++;
    switch (st.phase) {
      case 'lobby':
      case 'results':
        if (st.quick && this.clients.length > 0 && --this.phaseTimer <= 0) this.startMatch();
        return;
      case 'countdown':
        if (++this.secondAcc >= TICK_RATE) {
          this.secondAcc = 0;
          if (--st.countdown <= 0) st.phase = 'playing';
        }
        break;
      case 'playing':
        if (++this.secondAcc >= TICK_RATE) {
          this.secondAcc = 0;
          this.onSecond();
        }
        break;
    }
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
    if (st.phase === 'playing') {
      this.stepHill();
      this.flushPaint();
      if (this.isScoreLimit()) this.endMatch();
    }
  }

  private onSecond(): void {
    const st = this.state;
    st.timeLeft = Math.max(0, st.timeLeft - 1);
    if (st.mode === 'koth' && st.hillOwner >= 0) {
      if (st.hillOwner === 0) st.scoreA += MATCH.kothScorePerSec;
      else st.scoreB += MATCH.kothScorePerSec;
    }
    if (st.timeLeft <= 0) this.endMatch();
  }

  private isScoreLimit(): boolean {
    const st = this.state;
    let best = 0;
    for (const a of this.actors.values()) best = Math.max(best, a.s.score);
    return scoreLimitReached({ mode: st.mode as ModeId, scoreA: st.scoreA, scoreB: st.scoreB, bestPlayerScore: best });
  }

  private stepHill(): void {
    const st = this.state;
    if (st.mode !== 'koth') return;
    const hill = this.mw.map.hill;
    const inside: number[] = [];
    for (const a of this.actors.values()) {
      if (!a.s.alive || a.s.team < 0) continue;
      if (Math.hypot(a.motor.x - hill.p[0], a.motor.z - hill.p[2]) > hill.radius) continue;
      if (a.motor.y < hill.p[1] - 1) continue;
      inside.push(a.s.team);
      a.stats.hillTicks++;
      a.s.score = Math.floor(a.stats.hillTicks / TICK_RATE);
    }
    const r = evaluateHill(inside);
    st.hillOwner = r.owner;
    st.hillContested = r.contested;
  }

  private flushPaint(): void {
    const st = this.state;
    if (st.mode !== 'paint' || !this.paint) return;
    if (st.tick % PAINT.broadcastEveryTicks !== 0) return;
    st.scoreA = this.paint.counts[0];
    st.scoreB = this.paint.counts[1];
    if (!this.paintOut.length) return;
    const flat: number[] = [];
    for (const idx of this.paintOut) flat.push(idx, this.paint.cells[idx]);
    this.broadcast(MSG.PaintDelta, flat);
    this.paintOut.length = 0;
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
    if (ev.dashed && a.def.toastDash && this.canFight()) this.combat.spawnToast(a);
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
