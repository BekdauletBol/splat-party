// Application flow: menu → (lobby ⇄ match ⇄ results), driven by the room's phase.
import { CharacterId, JoinOptions, MATCH, MSG, MatchResults, initPhysics } from '@splat/shared';
import { sfx } from './audio/sfx';
import { Game } from './game';
import { Connection } from './net/connection';
import { loadSettings, saveSettings } from './settings';
import { createDevPanel } from './ui/devpanel';
import { Lobby, MainMenu, PauseMenu, showResults } from './ui/screens';

const params = new URLSearchParams(location.search);
const settings = loadSettings();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

let menu: MainMenu | null = null;

function joinOptions(): JoinOptions {
  if (!settings.nick) {
    settings.nick = `Игрок${Math.floor(Math.random() * 900 + 100)}`;
    saveSettings(settings);
  }
  return { nick: settings.nick, char: settings.char };
}

class Session {
  private game: Game | null = null;
  private lobby: Lobby | null = null;
  private pause: PauseMenu | null = null;
  private results: HTMLElement | null = null;
  private phase = '';
  private mapLoaded = '';
  private pendingResults: MatchResults | null = null;

  constructor(private net: Connection) {
    Object.assign(window, { __net: net, __session: this });
    menu?.hide();
    menu = null;
    history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), room: net.room.roomId })}`);
    net.onLeave = (code) => {
      // 4000 = our own consented leave; anything else is a lost connection.
      if (code !== 1000 && code !== 4000) {
        alert('Соединение с сервером потеряно');
        goHome();
      }
    };
    net.room.onStateChange(() => this.onState());
    net.room.onMessage(MSG.Results, (r: MatchResults) => {
      this.pendingResults = r;
      this.showResults();
    });
    net.room.onMessage(MSG.PaintFull, (cells: number[]) => this.game?.paintFull(cells));
    net.room.onMessage(MSG.PaintDelta, (flat: number[]) => this.game?.paintDelta(flat));
    this.onState();
  }

  private resume(): void {
    this.pause?.show(false);
    this.game?.input.lock();
  }

  private ensureGame(): Game {
    if (!this.game) {
      this.game = new Game(canvas, this.net, ui);
      this.game.applySettings(settings);
      this.pause = new PauseMenu(ui, settings, {
        resume: () => this.resume(),
        leave: () => goHome(this.net),
        apply: (s) => {
          this.game?.applySettings(s);
          sfx.setVolume(s.volume);
        },
      });
      this.game.input.onEscape = () => {
        if (this.phase === 'playing' || this.phase === 'countdown') this.pause?.show(true);
      };
      if (params.has('dev')) createDevPanel(this.net);
      Object.assign(window, { __game: this.game });
    }
    return this.game;
  }

  private onState(): void {
    const st = this.net.state;
    if (!st.phase) return;
    if (st.phase !== this.phase) this.enterPhase(st.phase);
    if (st.phase === 'lobby') this.lobby?.update(st);
  }

  private enterPhase(phase: string): void {
    this.phase = phase;
    const st = this.net.state;
    if (phase === 'lobby') {
      this.results?.remove();
      this.results = null;
      this.game?.stop();
      this.pause?.show(false);
      if (document.pointerLockElement) document.exitPointerLock();
      this.lobby = new Lobby(ui, this.net.room.roomId, this.net.sessionId, {
        ready: () => this.net.send(MSG.Ready),
        start: () => this.net.send(MSG.Start),
        settings: (patch) => this.net.send(MSG.Settings, patch),
        char: (c: CharacterId) => this.net.send(MSG.SetChar, c),
        leave: () => goHome(this.net),
      }, settings);
      this.lobby.update(st);
    } else if (phase === 'countdown' || phase === 'playing') {
      this.lobby?.remove();
      this.lobby = null;
      this.results?.remove();
      this.results = null;
      const game = this.ensureGame();
      if (!game.isRunning || this.mapLoaded !== st.map) {
        game.enterMatch(st.map, st.mode);
        this.mapLoaded = st.map;
        game.input.lock();
      }
    } else if (phase === 'results') {
      if (document.pointerLockElement) document.exitPointerLock();
      this.pause?.show(false);
      this.showResults();
    }
  }

  private showResults(): void {
    if (!this.pendingResults || this.phase !== 'results' || this.results) return;
    this.game?.stop();
    this.results = showResults(
      ui,
      this.pendingResults,
      this.net.sessionId,
      () => this.net.state.host === this.net.sessionId,
      this.net.state.quick,
      () => this.net.send(MSG.Again),
      () => goHome(this.net),
    );
    this.pendingResults = null;
  }
}

function goHome(net?: Connection): void {
  net?.leave();
  location.href = location.pathname;
}

function showMenu(net: Connection, enter: () => void, error?: string): void {
  menu = new MainMenu(ui, settings, {
    create: async (opts) => {
      await net.create({ ...opts, ...joinOptions() });
      enter();
    },
    join: async (code) => {
      if (code.length !== MATCH.codeLength) throw new Error(`Код состоит из ${MATCH.codeLength} символов`);
      try {
        await net.join(code, joinOptions());
      } catch {
        throw new Error(`Комната ${code} не найдена или заполнена`);
      }
      enter();
    },
    quick: async () => {
      await net.quick(joinOptions());
      enter();
    },
  });
  if (error) menu.showError(error);
}

async function main(): Promise<void> {
  await initPhysics();
  sfx.setVolume(settings.volume);
  document.getElementById('boot')?.remove();
  const net = new Connection();
  const enter = (): void => void new Session(net);
  const code = params.get('room');
  if (code) {
    try {
      await net.join(code.toUpperCase().slice(0, MATCH.codeLength), joinOptions());
      enter();
    } catch {
      params.delete('room');
      history.replaceState(null, '', location.pathname);
      showMenu(net, enter, `Комната ${code.toUpperCase()} не найдена или заполнена`);
    }
    return;
  }
  showMenu(net, enter);
}

main().catch((e) => console.error(e));
