// In-match HUD built from DOM: health, ammo, timer, score, killfeed, hit feedback.
import { DeathCause, RENDER, SnapPlayer, TICK_RATE, WEAPONS, WEAPON_COUNT } from '@splat/shared';

// Icon plus a word: the newest emoji are missing from older systems' fonts.
const CAUSE_ICON: Record<DeathCause, string> = { paint: '🎨 краской', plunger: '🪠 вантузом', chicken: '🐔 курицей', bubble: '🫧 пузырём', toast: '🍞 тостом', thorns: '🌵 шипами', fall: '💨 в пропасть' };

const html = `
<div id="hud" class="hud hidden">
  <div class="vignette" id="vignette"></div>
  <div class="crosshair" id="crosshair"></div>
  <div class="hitmarker" id="hitmarker"></div>
  <div class="top">
    <div class="pill" id="score-a"></div>
    <div class="timer" id="timer">5:00</div>
    <div class="pill" id="score-b"></div>
  </div>
  <div class="objective" id="objective"></div>
  <div class="killfeed" id="killfeed"></div>
  <div class="health"><div class="hp-label" id="hp-label"></div><div class="hp-track"><div class="hp-fill" id="hp-fill"></div></div></div>
  <div class="weapons" id="weapons"></div>
  <div class="dash" id="dash">Дэш</div>
  <div class="numbers" id="numbers"></div>
  <div class="death hidden" id="death"></div>
  <div class="scoreboard hidden" id="scoreboard"></div>
  <div class="click hidden" id="clickhint">Кликни, чтобы играть</div>
</div>`;

export class Hud {
  private root: HTMLElement;
  private $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  private hitT = 0;
  private lastHud = '';
  private lastBoard = '';
  private feed: { el: HTMLElement; t: number }[] = [];

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML('beforeend', html);
    this.root = this.$('hud');
    this.$('weapons').innerHTML = WEAPONS.map((w, i) => `<div class="slot" id="slot${i}"><span class="key">${i + 1}</span><span class="ico">${w.icon}</span><span class="wname">${w.short}</span><span class="wname">${w.short}</span><span class="ammo" id="ammo${i}"></span></div>`).join('');
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setClickHint(on: boolean): void {
    this.$('clickhint').classList.toggle('hidden', !on);
  }

  update(me: SnapPlayer | undefined, dt: number, tick: number): void {
    this.hitT -= dt;
    this.$('hitmarker').style.opacity = this.hitT > 0 ? '1' : '0';
    for (let i = this.feed.length - 1; i >= 0; i--) {
      if ((this.feed[i].t -= dt) <= 0) {
        this.feed[i].el.remove();
        this.feed.splice(i, 1);
      }
    }
    if (!me) return;
    const key = `${me.hp}|${me.maxHp}|${me.weapon}|${me.ammo1}|${me.ammo2}|${me.ammo3}`;
    if (key !== this.lastHud) {
      this.lastHud = key;
      this.$('hp-label').textContent = `❤ ${me.hp}`;
      const fill = this.$('hp-fill');
      fill.style.width = `${(100 * me.hp) / me.maxHp}%`;
      const low = me.alive && me.hp / me.maxHp < 0.3;
      fill.style.background = low ? '#f25c54' : '#7ae582';
      this.$('vignette').classList.toggle('on', low);
      const ammo = [Infinity, me.ammo1, me.ammo2, me.ammo3];
      for (let i = 0; i < WEAPON_COUNT; i++) {
        this.$(`ammo${i}`).textContent = ammo[i] === Infinity ? '∞' : String(ammo[i]);
        const el = this.$(`slot${i}`);
        el.classList.toggle('active', me.weapon === i);
        el.classList.toggle('empty', ammo[i] === 0);
      }
    }
    this.$('dash').classList.toggle('cooling', me.dashCd > 0);
    const death = this.$('death');
    if (!me.alive) {
      death.classList.remove('hidden');
      death.textContent = `Пуф! Возвращение через ${Math.max(1, Math.ceil((me.respawnAt - tick) / TICK_RATE))}…`;
    } else death.classList.add('hidden');
  }

  setTop(timeLeft: number, a: string, b: string, objective: string): void {
    this.$('timer').textContent = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`;
    this.$('score-a').innerHTML = a;
    this.$('score-b').innerHTML = b;
    this.$('objective').innerHTML = objective;
  }

  hitmarker(kill: boolean): void {
    this.hitT = RENDER.hitmarkerSec * (kill ? 2.5 : 1);
    this.$('hitmarker').classList.toggle('kill', kill);
  }

  damageNumber(x: number, y: number, dmg: number, self: boolean): void {
    const el = document.createElement('div');
    el.className = 'dmg' + (self ? ' self' : '');
    el.textContent = String(dmg);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.$('numbers').appendChild(el);
    setTimeout(() => el.remove(), RENDER.damageNumberLifeSec * 1000);
  }

  killfeed(killer: string | null, victim: string, cause: DeathCause, mine: boolean): void {
    const el = document.createElement('div');
    el.className = 'feed' + (mine ? ' mine' : '');
    const left = document.createElement('b');
    left.textContent = killer ?? '';
    const right = document.createElement('b');
    right.textContent = victim;
    el.append(left, ` ${CAUSE_ICON[cause]} `, right);
    this.$('killfeed').appendChild(el);
    this.feed.push({ el, t: RENDER.killfeedLifeSec });
  }

  scoreboard(show: boolean, players: SnapPlayer[], selfId: string, teams: boolean): void {
    const board = this.$('scoreboard');
    board.classList.toggle('hidden', !show);
    if (!show) return;
    const sorted = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills);
    const key = sorted.map((p) => `${p.id}${p.score}${p.kills}${p.deaths}${p.team}`).join();
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    board.textContent = '';
    const table = document.createElement('table');
    table.insertRow().innerHTML = '<th>Игрок</th><th>Очки</th><th>Киллы</th><th>Смерти</th>';
    for (const p of sorted) {
      const r = table.insertRow();
      if (p.id === selfId) r.className = 'me';
      if (teams) r.classList.add(p.team === 0 ? 'team-a' : 'team-b');
      r.insertCell().textContent = p.nick + (p.isBot ? ' 🤖' : '');
      for (const v of [p.score, p.kills, p.deaths]) r.insertCell().textContent = String(v);
    }
    board.appendChild(table);
  }
}
