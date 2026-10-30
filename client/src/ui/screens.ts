// Menu, lobby, results and pause screens (plain DOM).
import * as THREE from 'three';
import { BOT_LEVELS, CHARACTERS, CHARACTER_IDS, CharacterId, JoinOptions, MAPS, MAP_IDS, MATCH, MODES, MODE_IDS, MatchResults, ModeId, TEAM_NAMES } from '@splat/shared';
import { sfx } from '../audio/sfx';
import { CharacterView } from '../render/character';
import { Quality, Settings, saveSettings } from '../settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, text);
  b.addEventListener('click', () => {
    sfx.play('click');
    onClick();
  });
  return b;
}

function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', '', label);
    o.value = v;
    s.appendChild(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const f = el('label', 'field');
  f.append(el('span', '', label), control);
  return f;
}

// ---- rotating 3D preview ------------------------------------------------------------
class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private view: CharacterView | null = null;
  private raf = 0;
  private t = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.position.set(0, 0.5, 5.4);
    this.camera.lookAt(0, -0.02, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc0b8a0, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
  }

  set(char: CharacterId): void {
    this.view?.dispose();
    this.view = new CharacterView(char, 0xffd23f);
    this.scene.add(this.view.root);
    this.view.punch(10);
  }

  start(): void {
    let last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.t += dt;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (w && (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.view) {
        this.view.update({ dt, vx: 0, vy: 0, vz: 0, grounded: true, yaw: this.t * 0.9 + Math.PI, aimPitch: Math.sin(this.t) * 0.3, weapon: 0, bubble: false, alive: true });
      }
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}

// ---- main menu ------------------------------------------------------------------------
export interface MenuActions {
  create(opts: JoinOptions): Promise<void>;
  join(code: string): Promise<void>;
  quick(): Promise<void>;
}

export class MainMenu {
  readonly root = el('div', 'screen menu interactive');
  private preview: Preview;
  private error = el('div', 'error');

  constructor(parent: HTMLElement, private settings: Settings, private actions: MenuActions) {
    const title = el('h1', 'logo', 'Splat Party');
    const sub = el('div', 'tagline', 'Весёлый шутер, где вместо крови — краска и полёты');

    const left = el('div', 'panel');
    const nick = el('input');
    nick.maxLength = MATCH.maxNickLength;
    nick.placeholder = 'Твой ник';
    nick.value = settings.nick;
    nick.addEventListener('input', () => {
      settings.nick = nick.value;
      saveSettings(settings);
    });
    left.append(field('Ник', nick));

    const canvas = el('canvas', 'preview');
    this.preview = new Preview(canvas);
    const info = el('div', 'char-info');
    const chars = el('div', 'chars');
    const pick = (id: CharacterId): void => {
      settings.char = id;
      saveSettings(settings);
      this.preview.set(id);
      info.textContent = '';
      info.append(el('b', '', CHARACTERS[id].name), el('div', '', CHARACTERS[id].passive));
      for (const c of chars.children) c.classList.toggle('active', (c as HTMLElement).dataset.id === id);
    };
    for (const id of CHARACTER_IDS) {
      const b = button(CHARACTERS[id].name, 'char', () => pick(id));
      b.dataset.id = id;
      chars.appendChild(b);
    }
    const mid = el('div', 'panel char-panel');
    mid.append(canvas, info, chars);

    const right = el('div', 'panel');
    right.append(button('⚡ Быстрая игра', 'primary big', () => this.run(() => actions.quick())));
    const code = el('input');
    code.placeholder = 'КОД';
    code.maxLength = MATCH.codeLength;
    code.className = 'code-input';
    code.addEventListener('input', () => (code.value = code.value.toUpperCase()));
    const joinRow = el('div', 'row');
    joinRow.append(code, button('Войти по коду', '', () => this.run(() => actions.join(code.value.trim()))));
    right.append(joinRow);

    // Create-room form
    const form: JoinOptions = { mode: 'ffa', map: MAP_IDS[0], maxPlayers: MATCH.maxPlayers, bots: MATCH.defaultBots, difficulty: 1, isPrivate: false };
    right.append(el('h3', '', 'Своя комната'));
    right.append(settingsForm(form, (patch) => Object.assign(form, patch)));
    right.append(button('Создать комнату', 'primary', () => this.run(() => actions.create(form))));

    const layout = el('div', 'menu-layout');
    layout.append(left, mid, right);
    left.append(el('h3', '', 'Управление'));
    const help = el('div', 'help');
    help.innerHTML = 'WASD — бег<br>Мышь — прицел, ЛКМ — огонь, ПКМ — зум<br>Space — прыжок, Shift — дэш<br>1-4 — оружие, Tab — счёт, Esc — меню';
    left.append(help);
    this.root.append(title, sub, layout, this.error);
    parent.appendChild(this.root);
    pick(settings.char);
    this.preview.start();
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.error.textContent = '';
    try {
      await fn();
    } catch (e) {
      this.showError((e as Error).message || 'Не получилось подключиться');
    }
  }

  showError(text: string): void {
    this.error.textContent = text;
  }

  hide(): void {
    this.preview.stop();
    this.root.remove();
  }
}

function settingsForm(values: JoinOptions, onChange: (patch: JoinOptions) => void, disabled = false): HTMLElement {
  const box = el('div', 'form');
  const add = (label: string, control: HTMLSelectElement | HTMLInputElement): void => {
    control.disabled = disabled;
    box.appendChild(field(label, control));
  };
  add('Режим', select(MODE_IDS.map((m) => [m, MODES[m].name]), values.mode as string, (v) => onChange({ mode: v })));
  add('Карта', select(MAP_IDS.map((m) => [m, MAPS[m].name]), values.map as string, (v) => onChange({ map: v })));
  add('Игроков', select([2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)]), String(values.maxPlayers), (v) => onChange({ maxPlayers: Number(v) })));
  add('Ботов', select([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), String(n)]), String(values.bots), (v) => onChange({ bots: Number(v) })));
  add('Сложность', select(BOT_LEVELS.map((l, i) => [String(i), l.name]), String(values.difficulty), (v) => onChange({ difficulty: Number(v) })));
  const priv = el('input');
  priv.type = 'checkbox';
  priv.checked = values.isPrivate === true;
  priv.addEventListener('change', () => onChange({ isPrivate: priv.checked }));
  add('Приватная', priv);
  return box;
}

// ---- lobby ------------------------------------------------------------------------------
export interface LobbyActions {
  ready(): void;
  start(): void;
  settings(patch: JoinOptions): void;
  char(c: CharacterId): void;
  leave(): void;
}

export class Lobby {
  readonly root = el('div', 'screen lobby interactive');
  private list = el('div', 'players');
  private settingsBox = el('div');
  private actionsBox = el('div', 'row');
  private lastKey = '';

  constructor(parent: HTMLElement, private code: string, private selfId: string, private actions: LobbyActions, private settings: Settings) {
    const link = `${location.origin}${location.pathname}?room=${code}`;
    const head = el('div', 'lobby-head');
    head.append(el('h2', '', 'Лобби'), el('div', 'room-code', code));
    const copy = button('Скопировать приглашение', '', () => {
      void navigator.clipboard?.writeText(link);
      copy.textContent = 'Скопировано!';
    });
    head.append(copy);
    const charPick = select(CHARACTER_IDS.map((c) => [c, CHARACTERS[c].name]), settings.char, (v) => {
      settings.char = v as CharacterId;
      saveSettings(settings);
      actions.char(v as CharacterId);
    });
    const body = el('div', 'lobby-body');
    const left = el('div', 'panel');
    left.append(el('h3', '', 'Игроки'), this.list);
    const right = el('div', 'panel');
    right.append(field('Персонаж', charPick), el('h3', '', 'Настройки'), this.settingsBox);
    body.append(left, right);
    this.root.append(head, body, this.actionsBox);
    parent.appendChild(this.root);
  }

  update(state: any): void {
    const players: any[] = [];
    state.players.forEach((p: any) => players.push(p));
    const key = JSON.stringify([players.map((p) => [p.id, p.nick, p.ready, p.isBot, p.char, p.team]), state.host, state.mode, state.map, state.maxPlayers, state.botCount, state.difficulty, state.isPrivate]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const isHost = state.host === this.selfId;

    this.list.textContent = '';
    for (const p of players) {
      const row = el('div', 'player' + (p.id === this.selfId ? ' me' : ''));
      row.append(el('span', 'pname', `${p.id === state.host ? '👑 ' : ''}${p.nick}`), el('span', 'pchar', CHARACTERS[p.char as CharacterId]?.name ?? ''), el('span', 'pready', p.isBot ? '🤖 бот' : p.ready || p.id === state.host ? '✅ готов' : '⏳'));
      this.list.appendChild(row);
    }

    this.settingsBox.textContent = '';
    this.settingsBox.appendChild(
      settingsForm({ mode: state.mode, map: state.map, maxPlayers: state.maxPlayers, bots: state.botCount, difficulty: state.difficulty, isPrivate: state.isPrivate }, (patch) => this.actions.settings(patch), !isHost),
    );

    this.actionsBox.textContent = '';
    const me = players.find((p) => p.id === this.selfId);
    if (isHost) {
      const allReady = players.every((p) => p.ready || p.isBot || p.id === state.host);
      const start = button(allReady ? '▶ Начать матч' : 'Ждём готовности игроков', 'primary big', () => this.actions.start());
      start.disabled = !allReady;
      this.actionsBox.appendChild(start);
    } else {
      this.actionsBox.appendChild(button(me?.ready ? 'Не готов' : 'Готов!', 'primary big', () => this.actions.ready()));
    }
    this.actionsBox.appendChild(button('Выйти', '', () => this.actions.leave()));
  }

  remove(): void {
    this.root.remove();
  }
}

// ---- results --------------------------------------------------------------------------
export function showResults(parent: HTMLElement, r: MatchResults, selfId: string, isHost: () => boolean, quick: boolean, onAgain: () => void, onLeave: () => void): HTMLElement {
  const root = el('div', 'screen results interactive');
  let headline: string;
  if (MODES[r.mode].teams) headline = r.winnerTeam < 0 ? 'Ничья!' : `Победа: ${TEAM_NAMES[r.winnerTeam]}!`;
  else headline = r.rows[0] ? `Победитель: ${r.rows[0].nick}!` : 'Матч окончен';
  root.append(el('h1', 'logo', headline));
  if (MODES[r.mode].teams) root.append(el('div', 'tagline', `${TEAM_NAMES[0]} ${r.scoreA} : ${r.scoreB} ${TEAM_NAMES[1]}`));
  const body = el('div', 'lobby-body');
  const left = el('div', 'panel');
  const table = el('table');
  table.insertRow().innerHTML = '<th>Игрок</th><th>Очки</th><th>К</th><th>С</th>';
  for (const p of r.rows) {
    const row = table.insertRow();
    if (p.id === selfId) row.className = 'me';
    row.insertCell().textContent = p.nick + (p.isBot ? ' 🤖' : '');
    for (const v of [p.score, p.kills, p.deaths]) row.insertCell().textContent = String(v);
  }
  left.append(el('h3', '', 'Таблица'), table);
  const right = el('div', 'panel');
  right.append(el('h3', '', 'Награды'));
  if (!r.awards.length) right.append(el('div', '', 'В этот раз никто не отличился.'));
  for (const a of r.awards) {
    const row = el('div', 'award');
    row.append(el('b', '', `🏆 ${a.title}`), el('span', '', `${a.nick} — ${a.value} ${a.desc}`));
    right.appendChild(row);
  }
  body.append(left, right);
  const actions = el('div', 'row');
  if (quick) actions.append(el('div', 'tagline', 'Следующий матч скоро начнётся…'));
  else if (isHost()) actions.append(button('Ещё раз', 'primary big', onAgain));
  else actions.append(el('div', 'tagline', 'Ждём, пока хост нажмёт «Ещё раз»…'));
  actions.append(button('Выйти', '', onLeave));
  root.append(body, actions);
  parent.appendChild(root);
  sfx.play('win');
  return root;
}

// ---- pause / settings -----------------------------------------------------------------
export interface PauseActions {
  resume(): void;
  leave(): void;
  apply(s: Settings): void;
}

export class PauseMenu {
  readonly root = el('div', 'screen pause interactive hidden');

  constructor(parent: HTMLElement, settings: Settings, actions: PauseActions) {
    const panel = el('div', 'panel');
    panel.append(el('h2', '', 'Пауза'));
    const sens = el('input');
    sens.type = 'range';
    sens.min = '0.2';
    sens.max = '3';
    sens.step = '0.05';
    sens.value = String(settings.sensitivity);
    sens.addEventListener('input', () => {
      settings.sensitivity = Number(sens.value);
      saveSettings(settings);
      actions.apply(settings);
    });
    const vol = el('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(settings.volume);
    vol.addEventListener('input', () => {
      settings.volume = Number(vol.value);
      saveSettings(settings);
      actions.apply(settings);
    });
    const qual = select([['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']], settings.quality, (v) => {
      settings.quality = v as Quality;
      saveSettings(settings);
      actions.apply(settings);
    });
    panel.append(field('Чувствительность мыши', sens), field('Громкость', vol), field('Качество графики', qual));
    const row = el('div', 'row');
    row.append(button('Продолжить', 'primary', () => actions.resume()), button('Выйти из матча', '', () => actions.leave()));
    panel.append(row);
    this.root.append(panel);
    parent.appendChild(this.root);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}
