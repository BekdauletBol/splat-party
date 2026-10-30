// Pure scoring rules: no I/O and no engine types, so they are simple to unit-test.
import { MATCH, ModeId, PAINT } from './constants';
import type { MapDef } from './maps';

// ---- paint grid -------------------------------------------------------------------
/** Team ownership per floor cell. Cell value: -1 = unpainted, otherwise a team index. */
export class PaintGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Int8Array;
  /** Height of the walkable surface per cell; NaN = nothing to paint here. */
  readonly surface: Float32Array;
  readonly normalX: Float32Array;
  readonly normalY: Float32Array;
  readonly normalZ: Float32Array;
  readonly counts: [number, number] = [0, 0];
  paintable = 0;

  constructor(readonly bounds: MapDef['bounds'], readonly cellSize: number = PAINT.cellSize) {
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cellSize);
    const n = this.cols * this.rows;
    this.cells = new Int8Array(n).fill(-1);
    this.surface = new Float32Array(n).fill(NaN);
    this.normalX = new Float32Array(n);
    this.normalY = new Float32Array(n).fill(1);
    this.normalZ = new Float32Array(n);
  }

  /** Fill surface data with a downward ray provider (Rapier on both sides). */
  scan(ray: (x: number, z: number) => { y: number; nx: number; ny: number; nz: number } | null): void {
    this.paintable = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = c + r * this.cols;
        const hit = ray(this.cellX(c), this.cellZ(r));
        if (!hit || hit.ny < PAINT.minNormalY) continue;
        this.surface[i] = hit.y;
        this.normalX[i] = hit.nx;
        this.normalY[i] = hit.ny;
        this.normalZ[i] = hit.nz;
        this.paintable++;
      }
    }
  }

  cellX(c: number): number {
    return this.bounds.minX + (c + 0.5) * this.cellSize;
  }
  cellZ(r: number): number {
    return this.bounds.minZ + (r + 0.5) * this.cellSize;
  }

  /** Stamp a disc; returns changed cell indices. Only touches surfaces near y. */
  brush(x: number, y: number, z: number, radius: number, team: number, out: number[] = []): number[] {
    const minC = Math.max(0, Math.floor((x - radius - this.bounds.minX) / this.cellSize));
    const maxC = Math.min(this.cols - 1, Math.floor((x + radius - this.bounds.minX) / this.cellSize));
    const minR = Math.max(0, Math.floor((z - radius - this.bounds.minZ) / this.cellSize));
    const maxR = Math.min(this.rows - 1, Math.floor((z + radius - this.bounds.minZ) / this.cellSize));
    const r2 = radius * radius;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const dx = this.cellX(c) - x;
        const dz = this.cellZ(r) - z;
        if (dx * dx + dz * dz > r2) continue;
        const i = c + r * this.cols;
        const sy = this.surface[i];
        if (Number.isNaN(sy) || Math.abs(sy - y) > radius + PAINT.verticalReach) continue;
        if (this.set(i, team)) out.push(i);
      }
    }
    return out;
  }

  set(i: number, team: number): boolean {
    const old = this.cells[i];
    if (old === team) return false;
    if (old >= 0) this.counts[old]--;
    this.cells[i] = team;
    if (team >= 0) this.counts[team]++;
    return true;
  }

  clear(): void {
    this.cells.fill(-1);
    this.counts[0] = this.counts[1] = 0;
  }

  percent(team: number): number {
    return this.paintable ? (100 * this.counts[team]) / this.paintable : 0;
  }
}

// ---- king of the hill ----------------------------------------------------------------
export interface HillResult {
  owner: number; // team index or -1
  contested: boolean;
}

/** A team holds the hill only while it is alone in the zone. */
export function evaluateHill(teamsInZone: number[]): HillResult {
  const set = new Set(teamsInZone);
  if (set.size === 0) return { owner: -1, contested: false };
  if (set.size > 1) return { owner: -1, contested: true };
  return { owner: teamsInZone[0], contested: false };
}

// ---- match end ------------------------------------------------------------------------
export interface ScoreView {
  mode: ModeId;
  scoreA: number;
  scoreB: number;
  bestPlayerScore: number;
}

export function scoreLimitReached(v: ScoreView): boolean {
  switch (v.mode) {
    case 'ffa':
      return v.bestPlayerScore >= MATCH.ffaKillLimit;
    case 'tdm':
      return Math.max(v.scoreA, v.scoreB) >= MATCH.tdmKillLimit;
    case 'koth':
      return Math.max(v.scoreA, v.scoreB) >= MATCH.kothScoreLimit;
    default:
      return false; // Paint always plays out the full clock
  }
}

/** Winning team index, or -1 on a draw. */
export function winningTeam(scoreA: number, scoreB: number): number {
  if (scoreA === scoreB) return -1;
  return scoreA > scoreB ? 0 : 1;
}

// ---- funny awards ----------------------------------------------------------------------
export interface AwardStats {
  nick: string;
  airTicks: number;
  launches: number;
  plungerHits: number;
  bubbleHits: number;
  toastHits: number;
  chickenKills: number;
  falls: number;
  paintCells: number;
  hillTicks: number;
  damageTaken: number;
  bestStreak: number;
}
export interface Award {
  title: string;
  desc: string;
  nick: string;
  value: number;
}

const AWARD_TABLE: { key: keyof Omit<AwardStats, 'nick'>; title: string; desc: string; min: number }[] = [
  { key: 'plungerHits', title: 'Король вантуза', desc: 'притянул больше всех', min: 1 },
  { key: 'airTicks', title: 'Больше всех летал', desc: 'тиков в воздухе', min: 90 },
  { key: 'launches', title: 'Живой снаряд', desc: 'раз запущен в небо', min: 2 },
  { key: 'chickenKills', title: 'Куриный бог', desc: 'побед курицей', min: 1 },
  { key: 'bubbleHits', title: 'Мыльный магнат', desc: 'пузырей на врагах', min: 1 },
  { key: 'toastHits', title: 'Тост за победу', desc: 'попаданий тостом', min: 1 },
  { key: 'falls', title: 'Закон гравитации', desc: 'падений с карты', min: 1 },
  { key: 'paintCells', title: 'Маляр года', desc: 'клеток закрашено', min: 20 },
  { key: 'hillTicks', title: 'Хозяин горы', desc: 'тиков на вершине', min: 30 },
  { key: 'damageTaken', title: 'Груша для битья', desc: 'урона принято', min: 100 },
  { key: 'bestStreak', title: 'Машина хаоса', desc: 'киллов подряд', min: 3 },
];

/** The most impressive awards, at most one per player if enough people qualify. */
export function computeAwards(players: AwardStats[], maxAwards = 5): Award[] {
  const all: Award[] = [];
  for (const row of AWARD_TABLE) {
    let best: AwardStats | null = null;
    for (const p of players) if (p[row.key] >= row.min && (!best || p[row.key] > best[row.key])) best = p;
    if (best) all.push({ title: row.title, desc: row.desc, nick: best.nick, value: best[row.key] });
  }
  const seen = new Set<string>();
  const first: Award[] = [];
  const rest: Award[] = [];
  for (const a of all) {
    if (seen.has(a.nick)) rest.push(a);
    else {
      seen.add(a.nick);
      first.push(a);
    }
  }
  return [...first, ...rest].slice(0, maxAwards);
}

export interface ResultRow {
  id: string;
  nick: string;
  char: string;
  team: number;
  isBot: boolean;
  kills: number;
  deaths: number;
  score: number;
}
export interface MatchResults {
  mode: ModeId;
  winnerTeam: number;
  winnerId: string | null;
  scoreA: number;
  scoreB: number;
  rows: ResultRow[];
  awards: Award[];
}
