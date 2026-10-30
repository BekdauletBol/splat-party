// Wraps the Colyseus room: applies debug lag, keeps a snapshot buffer with a
// server-time estimate, and exposes plain data to the rest of the client.
import { Client, Room } from 'colyseus.js';
import {
  GameEvent, JoinOptions, MSG, NET, PHYS, PlayerInput, ROOM_NAME, SERVER_PORT, SnapPickup, SnapPlayer, SnapProjectile, SnapProp, TICK_DT,
} from '@splat/shared';
import { inbound, outbound } from './lagsim';

export interface Snapshot {
  tick: number;
  players: Map<string, SnapPlayer>;
  projectiles: Map<string, SnapProjectile>;
  props: Map<string, SnapProp>;
  pickups: Map<string, SnapPickup>;
}

const TICK_MS = TICK_DT * 1000;
const PLAYER_KEYS: (keyof SnapPlayer)[] = [
  'id', 'nick', 'char', 'team', 'isBot', 'ready', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'ay', 'ap', 'grounded', 'jumpsUsed', 'coyote', 'dashCd', 'dashT', 'dashX', 'dashZ', 'jumpHeld', 'dashHeld',
  'bubble', 'lastSeq', 'teleport', 'hp', 'maxHp', 'alive', 'weapon', 'ammo1', 'ammo2', 'ammo3', 'kills', 'deaths', 'score', 'respawnAt', 'firing', 'aiming', 'plungered', 'plungerX', 'plungerY', 'plungerZ',
];

function copyMap<T>(src: { forEach(cb: (v: T, k: string) => void): void }, keys?: (keyof T)[]): Map<string, T> {
  const out = new Map<string, T>();
  src.forEach((v, k) => {
    if (keys) {
      const o = {} as T;
      for (const key of keys) o[key] = v[key];
      out.set(k, o);
    } else out.set(k, { ...v });
  });
  return out;
}

const PROJ_KEYS: (keyof SnapProjectile)[] = ['id', 'kind', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'owner', 'stuck'];
const PROP_KEYS: (keyof SnapProp)[] = ['id', 'kind', 'radius', 'color', 'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw'];
const PICKUP_KEYS: (keyof SnapPickup)[] = ['id', 'weapon', 'x', 'y', 'z', 'active'];

export function serverUrl(): string {
  const proto = location.protocol === 'https:' ? 'https' : 'http';
  // In dev Vite serves the page and Colyseus listens next door; in prod they share a port.
  return import.meta.env.DEV ? `${proto}://${location.hostname}:${SERVER_PORT}` : `${proto}://${location.host}`;
}

export class Connection {
  private client = new Client(serverUrl());
  room!: Room;
  snapshots: Snapshot[] = [];
  onSnapshot: (s: Snapshot) => void = () => {};
  onEvent: (e: GameEvent) => void = () => {};
  onLeave: (code: number) => void = () => {};
  private serverOffset: number | null = null; // serverMs - localMs

  async create(opts: JoinOptions): Promise<void> {
    this.attach(await this.client.create(ROOM_NAME, opts));
  }
  async join(code: string, opts: JoinOptions): Promise<void> {
    this.attach(await this.client.joinById(code, opts));
  }
  async quick(opts: JoinOptions): Promise<void> {
    this.attach(await this.client.joinOrCreate(ROOM_NAME, { ...opts, quick: true }));
  }

  private attach(room: Room): void {
    this.room = room;
    room.onStateChange((state: any) => {
      const snap: Snapshot = {
        tick: state.tick,
        players: copyMap<SnapPlayer>(state.players, PLAYER_KEYS),
        projectiles: copyMap<SnapProjectile>(state.projectiles, PROJ_KEYS),
        props: copyMap<SnapProp>(state.props, PROP_KEYS),
        pickups: copyMap<SnapPickup>(state.pickups, PICKUP_KEYS),
      };
      inbound(() => this.pushSnapshot(snap), true);
    });
    room.onMessage(MSG.Event, (e: GameEvent) => inbound(() => this.onEvent(e)));
    room.onMessage(MSG.Tuned, (values: Partial<typeof PHYS>) => Object.assign(PHYS, values));
    room.onLeave((code) => this.onLeave(code));
  }

  private pushSnapshot(s: Snapshot): void {
    const now = performance.now();
    const offset = s.tick * TICK_MS - now;
    // Keep the smallest latency seen, slowly forgetting it so clock drift can't stick.
    if (this.serverOffset === null || offset > this.serverOffset) this.serverOffset = offset;
    else this.serverOffset -= 0.02;
    this.snapshots.push(s);
    if (this.snapshots.length > NET.snapshotBuffer) this.snapshots.shift();
    this.onSnapshot(s);
  }

  /** Server-tick (fractional) that remote entities should currently be drawn at. */
  renderTick(now: number): number {
    if (this.serverOffset === null) return 0;
    return (now + this.serverOffset - NET.interpDelayMs) / TICK_MS;
  }

  sendInputs(inputs: PlayerInput[]): void {
    const payload = inputs.slice();
    outbound(() => this.room.connection.isOpen && this.room.send(MSG.Input, payload), true);
  }

  send(type: string, data?: unknown): void {
    outbound(() => this.room.connection.isOpen && this.room.send(type, data));
  }

  get sessionId(): string {
    return this.room.sessionId;
  }
  get state(): any {
    return this.room.state;
  }

  leave(): void {
    this.room?.leave();
  }
}

/** Find the pair of snapshots around `tick`; returns [from, to, alpha]. */
export function bracket(snaps: Snapshot[], tick: number): [Snapshot, Snapshot, number] | null {
  if (!snaps.length) return null;
  for (let i = snaps.length - 1; i > 0; i--) {
    const a = snaps[i - 1];
    const b = snaps[i];
    if (a.tick <= tick) {
      if (b.tick <= a.tick) return [b, b, 0];
      return [a, b, Math.min(1, Math.max(0, (tick - a.tick) / (b.tick - a.tick)))];
    }
  }
  return [snaps[0], snaps[0], 0];
}
