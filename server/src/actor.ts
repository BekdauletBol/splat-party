// Server-side runtime data for one player (human or bot), next to its Schema twin.
import { CHARACTERS, CharacterId, MotorState, NET, PlayerInput, makeMotorState } from '@splat/shared';
import { PlayerS } from './schema';

export interface HistoryEntry {
  tick: number;
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export interface MatchStats {
  airTicks: number;
  launches: number;
  plungerHits: number;
  bubbleHits: number;
  toastHits: number;
  chickenKills: number;
  falls: number;
  paintCells: number;
  hillTicks: number;
  damageDealt: number;
  damageTaken: number;
  bestStreak: number;
  streak: number;
}
export const emptyStats = (): MatchStats => ({ airTicks: 0, launches: 0, plungerHits: 0, bubbleHits: 0, toastHits: 0, chickenKills: 0, falls: 0, paintCells: 0, hillTicks: 0, damageDealt: 0, damageTaken: 0, bestStreak: 0, streak: 0 });

export class Actor {
  motor: MotorState = makeMotorState();
  queue: PlayerInput[] = [];
  budget: number = NET.inputBudgetCap;
  idleTicks = 0;
  lastInput: PlayerInput = { s: 0, mx: 0, mz: 0, y: 0, ay: 0, ap: 0, b: 0, w: 0, v: 0 };
  history: HistoryEntry[] = [];
  cooldown = 0;
  spawnProtect = 0;
  respawnTick = 0;
  lastDamageBy: string | null = null;
  lastDamageTick = -9999;
  contactCd = new Map<string, number>();
  bumpCd = 0;
  /** Plunger pull: the player is dragged toward (px,py,pz) for pullTicks. */
  pullTicks = 0;
  px = 0;
  py = 0;
  pz = 0;
  /** Shooter that pulls this actor toward themselves (plunger stuck on a player). */
  pullBy: string | null = null;
  stats: MatchStats = emptyStats();

  constructor(readonly s: PlayerS) {}

  get charId(): CharacterId {
    return this.s.char as CharacterId;
  }
  get def() {
    return CHARACTERS[this.charId];
  }

  /** Copy authoritative motor state into the Schema for replication. */
  sync(): void {
    const m = this.motor;
    const s = this.s;
    s.x = m.x; s.y = m.y; s.z = m.z;
    s.vx = m.vx; s.vy = m.vy; s.vz = m.vz;
    s.grounded = m.grounded;
    s.jumpsUsed = m.jumpsUsed;
    s.coyote = m.coyote;
    s.dashCd = m.dashCd;
    s.dashT = m.dashT;
    s.dashX = m.dashX;
    s.dashZ = m.dashZ;
    s.jumpHeld = m.jumpHeld;
    s.dashHeld = m.dashHeld;
    s.bubble = m.bubble;
  }

  record(tick: number): void {
    const h = this.history;
    h.push({ tick, x: this.motor.x, y: this.motor.y, z: this.motor.z, alive: this.s.alive });
    if (h.length > NET.historyTicks) h.shift();
  }

  /** Position at a past tick, for lag-compensated hit tests. */
  rewound(tick: number): HistoryEntry | null {
    const h = this.history;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].tick <= tick) return h[i];
    return h[0] ?? null;
  }
}
