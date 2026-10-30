// Wire protocol shared by client and server. Client → server carries only inputs
// and lobby intents; anything gameplay-related is decided by the server.
import { PHYS } from './constants';
import type { MotorState } from './motor';

export const MSG = {
  Input: 'i',
  Tune: 'tune',
  Tuned: 'tuned',
  Event: 'ev',
  Ready: 'ready',
  Start: 'start',
  Again: 'again',
  Settings: 'settings',
  SetChar: 'char',
  PaintFull: 'paintfull',
  PaintDelta: 'paint',
  Results: 'results',
} as const;

export const ROOM_NAME = 'splat';

export interface JoinOptions {
  nick?: string;
  char?: string;
  quick?: boolean;
  mode?: string;
  map?: string;
  maxPlayers?: number;
  bots?: number;
  difficulty?: number;
  isPrivate?: boolean;
}

/** Plain copy of a networked player, taken every time a server patch arrives. */
export interface SnapPlayer extends MotorState {
  id: string;
  nick: string;
  char: string;
  team: number;
  isBot: boolean;
  ready: boolean;
  yaw: number;
  ay: number;
  ap: number;
  lastSeq: number;
  teleport: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  weapon: number;
  ammo1: number;
  ammo2: number;
  ammo3: number;
  kills: number;
  deaths: number;
  score: number;
  respawnAt: number;
  firing: boolean;
  aiming: boolean;
  plungerX: number;
  plungerY: number;
  plungerZ: number;
  plungered: boolean;
}

export interface SnapProjectile {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: string;
  stuck: boolean;
}
export interface SnapProp {
  id: number;
  kind: string;
  radius: number;
  color: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}
export interface SnapPickup {
  id: number;
  weapon: number;
  x: number;
  y: number;
  z: number;
  active: boolean;
}

export const enum ProjKind {
  Plunger = 1,
  Chicken = 2,
  Bubble = 3,
  Toast = 4,
}

export type DeathCause = 'paint' | 'plunger' | 'chicken' | 'bubble' | 'toast' | 'thorns' | 'fall';

export type GameEvent =
  | { t: 'hit'; victim: string; by: string; dmg: number; x: number; y: number; z: number; color: number }
  | { t: 'shot'; by: string; weapon: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; color: number; hitWorld: boolean }
  | { t: 'launch'; by: string; weapon: number }
  | { t: 'boom'; x: number; y: number; z: number; radius: number; color: number }
  | { t: 'kill'; victim: string; by: string | null; cause: DeathCause; vx: number; vy: number; vz: number }
  | { t: 'bubble'; victim: string }
  | { t: 'pop'; victim: string }
  | { t: 'stick'; x: number; y: number; z: number }
  | { t: 'pickup'; id: string; weapon: number }
  | { t: 'motor'; id: string; kind: 'jump' | 'djump' | 'dash' | 'pad' | 'land' | 'bounce'; v: number }
  | { t: 'bump'; id: string; x: number; y: number; z: number }
  | { t: 'matchstart' }
  | { t: 'botjoin'; nick: string }
  | { t: 'botleave'; nick: string };

export function isPhysKey(k: string): k is keyof typeof PHYS {
  return Object.prototype.hasOwnProperty.call(PHYS, k);
}
