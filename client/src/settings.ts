// Per-browser preferences in localStorage; everything falls back to defaults if blocked.
import { AUDIO, CAMERA, CHARACTER_IDS, CharacterId } from '@splat/shared';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  nick: string;
  char: CharacterId;
  sensitivity: number; // multiplier of the base mouse sensitivity
  volume: number;
  quality: Quality;
}

const KEY = 'splat-settings';
const defaults: Settings = { nick: '', char: 'pelmen', sensitivity: 1, volume: AUDIO.defaultVolume, quality: 'medium' };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const s = { ...defaults, ...raw };
    if (!CHARACTER_IDS.includes(s.char)) s.char = defaults.char;
    return s;
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings just don't persist */
  }
}

export const baseSensitivity = CAMERA.sensitivityDefault;
