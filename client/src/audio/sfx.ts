// All sounds are synthesized at startup into WAV data URIs and played through Howler.
import { Howl, Howler } from 'howler';
import { AUDIO } from '@splat/shared';

const RATE = 22050;
type Gen = (t: number, i: number) => number;

function wavUri(duration: number, gen: Gen): string {
  const n = Math.floor(duration * RATE);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, gen(i / RATE, i)));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

const sin = (f: number, t: number): number => Math.sin(2 * Math.PI * f * t);
const square = (f: number, t: number): number => (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1);
const noise = (): number => Math.random() * 2 - 1;
const env = (t: number, d: number, attack = 0.005): number => Math.min(1, t / attack) * Math.max(0, 1 - t / d);
/** Integrates a sweeping frequency so glides don't click. */
function sweep(from: number, to: number, d: number): (t: number) => number {
  return (t) => {
    const k = Math.min(1, t / d);
    return Math.sin(2 * Math.PI * (from * t + ((to - from) * k * t) / 2));
  };
}

const DEFS: Record<string, [number, Gen]> = (() => {
  const pew = sweep(1100, 240, 0.09);
  const thwop = sweep(180, 620, 0.16);
  const squawk = sweep(900, 420, 0.3);
  const blip = sweep(320, 1500, 0.22);
  const boing = sweep(180, 760, 0.2);
  const pad = sweep(140, 1100, 0.36);
  const slide = sweep(900, 110, 0.55);
  const whoosh = sweep(500, 120, 0.2);
  return {
    paint: [0.09, (t) => (pew(t) * 0.5 + noise() * 0.28) * env(t, 0.09)],
    plunger: [0.18, (t) => thwop(t) * 0.8 * env(t, 0.18)],
    stick: [0.13, (t) => (sweep(700, 90, 0.13)(t) * 0.7 + noise() * 0.1) * env(t, 0.13)],
    chicken: [0.32, (t) => (squawk(t) * square(38, t) * 0.5 + noise() * 0.08) * env(t, 0.32)],
    boom: [0.75, (t) => (noise() * 0.85 * Math.exp(-t * 6) + sin(62 * (1 - t * 0.5), t) * Math.exp(-t * 4.5)) * Math.min(1, t / 0.004)],
    bubble: [0.24, (t) => blip(t) * 0.55 * env(t, 0.24)],
    pop: [0.07, (t) => (sweep(1500, 300, 0.07)(t) * 0.7 + noise() * 0.2) * env(t, 0.07)],
    hit: [0.05, (t) => square(1300, t) * 0.3 * env(t, 0.05)],
    hurt: [0.14, (t) => sweep(420, 180, 0.14)(t) * 0.6 * env(t, 0.14)],
    kill: [0.3, (t) => square(t < 0.09 ? 660 : t < 0.18 ? 880 : 1320, t) * 0.25 * env(t, 0.3)],
    jump: [0.2, (t) => boing(t) * 0.42 * env(t, 0.2)],
    pad: [0.36, (t) => pad(t) * 0.5 * env(t, 0.36)],
    land: [0.11, (t) => (sin(95, t) * 0.8 + noise() * 0.18) * env(t, 0.11)],
    jelly: [0.28, (t) => sin(170 + 90 * Math.sin(t * 60), t) * 0.7 * env(t, 0.28)],
    dash: [0.2, (t) => (noise() * 0.45 + whoosh(t) * 0.25) * env(t, 0.2, 0.03)],
    pickup: [0.26, (t) => square(t < 0.08 ? 523 : t < 0.16 ? 659 : 784, t) * 0.22 * env(t, 0.26)],
    death: [0.55, (t) => slide(t) * 0.55 * env(t, 0.55)],
    poof: [0.3, (t) => noise() * 0.45 * env(t, 0.3, 0.03) * (1 - t)],
    click: [0.04, (t) => square(900, t) * 0.22 * env(t, 0.04)],
    win: [0.8, (t) => square([523, 659, 784, 1047][Math.min(3, Math.floor(t / 0.2))], t) * 0.22 * Math.max(0, 1 - t / 0.8)],
  };
})();

export type SfxName = keyof typeof DEFS;

class Sfx {
  private bank = new Map<string, Howl>();
  private ready = false;
  listener = { x: 0, y: 0, z: 0 };

  private init(): void {
    if (this.ready) return;
    this.ready = true;
    for (const [name, [dur, gen]] of Object.entries(DEFS)) this.bank.set(name, new Howl({ src: [wavUri(dur, gen)], format: ['wav'], pool: 8 }));
  }

  setVolume(v: number): void {
    Howler.volume(v);
  }

  /** Non-positional sound (UI, own weapon). */
  play(name: SfxName, volume = 1, rate = 1): void {
    this.init();
    const h = this.bank.get(name);
    if (!h) return;
    const id = h.play();
    h.volume(volume, id);
    if (rate !== 1) h.rate(rate, id);
  }

  /** Volume falls off with distance from the camera. */
  at(name: SfxName, x: number, y: number, z: number, volume = 1): void {
    const l = this.listener;
    const d = Math.hypot(x - l.x, y - l.y, z - l.z);
    if (d >= AUDIO.maxHearDistance) return;
    const k = 1 - d / AUDIO.maxHearDistance;
    this.play(name, volume * k * k, 0.95 + Math.random() * 0.1);
  }
}

export const sfx = new Sfx();
Howler.volume(AUDIO.defaultVolume);
