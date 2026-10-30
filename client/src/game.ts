// In-match client: fixed-tick prediction, snapshot interpolation, camera, events.
import * as THREE from 'three';
import {
  Btn, CAMERA, CAPSULE_FOOT, COMBAT, CharacterId, FFA_COLORS, GameEvent, MAPS, MATCH, MODES, ModeId, MotorEvents, MotorWorld, NET, PlayerInput, ProjKind, RENDER, SnapPickup, SnapPlayer, TEAM_COLORS, TEAM_NAMES, TICK_DT, WEAPONS, WeaponId,
  aimDirection, buildMapWorld, muzzleOf, rayCapsule, raycastStatic,
} from '@splat/shared';
import { sfx } from './audio/sfx';
import { InputState } from './input';
import { Connection, Snapshot, bracket } from './net/connection';
import { Predictor } from './net/predictor';
import { CharacterView, buildChicken, buildWeaponModel } from './render/character';
import { Fx } from './render/fx';
import { buildMapView, buildSky } from './render/mapView';
import { part, toon } from './render/toon';
import { PaintView } from './render/paintView';
import { Quality, Settings, baseSensitivity } from './settings';
import { Hud } from './ui/hud';
import { quality as toonQuality, outlineMaterial } from './render/toon';

interface Remote {
  view: CharacterView;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  wasAlive: boolean;
  wasBubble: boolean;
  teamShown: number;
  char: string;
}

const LAUNCH_SOUND = ['paint', 'plunger', 'chicken', 'bubble'] as const;

export function colorForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return FFA_COLORS[Math.abs(h) % FFA_COLORS.length];
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 800);
  readonly input: InputState;
  readonly hud: Hud;
  readonly fx: Fx;
  mw!: MotorWorld;
  predictor!: Predictor;
  private remotes = new Map<string, Remote>();
  private projViews = new Map<string, THREE.Object3D>();
  private propViews = new Map<string, THREE.Object3D>();
  private pickupViews = new Map<string, THREE.Object3D>();
  private seq = 0;
  private acc = 0;
  private lastFrame = performance.now();
  private recent: PlayerInput[] = [];
  private tmp = { x: 0, y: 0, z: 0 };
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private look = new THREE.Vector3();
  private projV = new THREE.Vector3();
  private mapGroup = new THREE.Group();
  private sun!: THREE.DirectionalLight;
  private running = false;
  private localFireReady = 0;
  private shake = 0;
  private zoom = 0;
  private lastHp = -1;
  private aimYaw = 0;
  private aimPitch = 0;
  private mode = 'ffa';
  private quality: Quality = 'medium';
  private paint: PaintView | null = null;
  private hillZone: THREE.Mesh | null = null;
  private matchObjects: THREE.Object3D[] = [];
  /** Latest authoritative copy of the local player. */
  me: SnapPlayer | undefined;

  constructor(private canvas: HTMLCanvasElement, private net: Connection, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatioCap.high));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new InputState(canvas);
    this.hud = new Hud(uiRoot);
    this.fx = new Fx(this.scene);
    addEventListener('resize', this.resize);
    this.resize();
    canvas.addEventListener('click', () => this.input.lock());
    this.input.onLockChange = (locked) => this.hud.setClickHint(!locked);
    net.onSnapshot = (s) => this.onSnapshot(s);
    net.onEvent = (e) => this.onEvent(e);
  }

  private resize = (): void => {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };

  /** Tear the previous match's scene down and build the map for a new one. */
  enterMatch(mapId: string, mode: string): void {
    for (const o of [...this.matchObjects]) this.scene.remove(o);
    this.matchObjects.length = 0;
    for (const v of [...this.propViews.values(), ...this.pickupViews.values(), ...this.projViews.values()]) this.scene.remove(v);
    this.propViews.clear();
    this.pickupViews.clear();
    this.projViews.clear();
    for (const r of this.remotes.values()) r.view.dispose();
    this.remotes.clear();
    this.net.snapshots.length = 0;
    this.me = undefined;
    this.lastHp = -1;
    this.mode = mode;
    this.loadMap(mapId);
    this.recent.length = 0;
    this.start();
  }

  private addToScene(...objs: THREE.Object3D[]): void {
    this.scene.add(...objs);
    this.matchObjects.push(...objs);
  }

  stop(): void {
    this.running = false;
    this.hud.show(false);
  }

  get isRunning(): boolean {
    return this.running;
  }

  paintFull(cells: number[]): void {
    this.paint?.applyFull(cells);
  }
  paintDelta(flat: number[]): void {
    this.paint?.applyDelta(flat);
  }

  applySettings(s: Settings): void {
    this.input.sensitivity = baseSensitivity * s.sensitivity;
    this.setQuality(s.quality);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatioCap[q]));
    this.resize();
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.sun) {
      this.sun.castShadow = q !== 'low';
      const size = RENDER.shadowMapSize[q] || 512;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    toonQuality.outlines = q !== 'low';
    outlineMaterial.visible = q !== 'low';
    this.fx.particleScale = q === 'low' ? 0.5 : 1;
  }

  loadMap(id: string): void {
    const map = MAPS[id];
    if (this.mw) this.mw.world.free();
    this.mw = buildMapWorld(map);
    this.scene.fog = new THREE.Fog(map.fog, 70, 240);
    this.mapGroup = buildMapView(map);
    this.addToScene(buildSky(map), this.mapGroup, new THREE.HemisphereLight(0xffffff, 0xb0a890, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER.shadowMapSize.high, RENDER.shadowMapSize.high);
    const f = RENDER.shadowFrustum + 10;
    Object.assign(sun.shadow.camera, { left: -f, right: f, top: f, bottom: -f, far: 160 });
    sun.shadow.bias = -0.0005;
    this.addToScene(sun, sun.target);
    this.sun = sun;
    this.setQuality(this.quality);
    this.predictor = new Predictor(this.mw, 'pelmen');
    this.paint = null;
    if (this.mode === 'paint') {
      this.paint = new PaintView(this.mw);
      this.addToScene(this.paint.mesh);
    }
    if (this.mode === 'koth') {
      const hill = map.hill;
      const zone = new THREE.Mesh(
        new THREE.CylinderGeometry(hill.radius, hill.radius, RENDER.hillZoneHeight, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
      );
      zone.position.set(hill.p[0], hill.p[1] + RENDER.hillZoneHeight / 2, hill.p[2]);
      this.hillZone = zone;
      this.addToScene(zone);
    } else this.hillZone = null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.hud.show(true);
    this.hud.setClickHint(!this.input.locked);
    requestAnimationFrame(this.frame);
  }

  private teamColor(p: SnapPlayer): number {
    return p.team >= 0 ? TEAM_COLORS[p.team] : colorForId(p.id);
  }

  private onSnapshot(s: Snapshot): void {
    if (!this.running) return;
    const selfId = this.net.sessionId;
    this.me = s.players.get(selfId);
    if (this.me) {
      this.predictor.char = this.me.char as CharacterId;
      this.predictor.reconcile(this.me);
    }
    for (const [id, p] of s.players) {
      let r = this.remotes.get(id);
      if (r && r.char !== p.char) {
        r.view.dispose();
        this.remotes.delete(id);
        r = undefined;
      }
      if (!r) {
        const view = new CharacterView(p.char as CharacterId, this.teamColor(p), id === selfId ? undefined : p.nick);
        this.scene.add(view.root);
        r = { view, pos: new THREE.Vector3(p.x, p.y, p.z), vel: new THREE.Vector3(), wasAlive: p.alive, wasBubble: false, teamShown: p.team, char: p.char };
        this.remotes.set(id, r);
      }
      if (r.teamShown !== p.team) {
        r.teamShown = p.team;
        r.view.setTeamColor(this.teamColor(p));
      }
    }
    for (const [id, r] of this.remotes) {
      if (!s.players.has(id)) {
        r.view.dispose();
        this.remotes.delete(id);
      }
    }
    this.syncProps(s);
    this.syncPickups(s);
    this.syncProjectiles(s);
    if (this.me) {
      if (this.lastHp >= 0 && this.me.hp < this.lastHp) this.shake = Math.max(this.shake, RENDER.shakeHit);
      this.lastHp = this.me.hp;
      // Auto-switch away from an emptied slot.
      const ammo = [1, this.me.ammo1, this.me.ammo2, this.me.ammo3];
      if (!ammo[this.input.weaponSlot]) this.input.weaponSlot = this.me.weapon === this.input.weaponSlot ? WeaponId.Paint : this.input.weaponSlot;
    }
  }

  private syncProps(s: Snapshot): void {
    for (const [id, p] of s.props) {
      if (this.propViews.has(id)) continue;
      const geo = p.kind === 'ball' ? new THREE.SphereGeometry(p.radius, 24, 16) : new THREE.BoxGeometry(p.radius * 2, p.radius * 2, p.radius * 2);
      const mesh = part(geo, p.color);
      mesh.receiveShadow = true;
      if (p.kind === 'ball') {
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(p.radius * 1.002, p.radius * 0.1, 6, 24), toon(0xffffff));
        mesh.add(stripe);
      }
      this.scene.add(mesh);
      this.propViews.set(id, mesh);
    }
  }

  private syncPickups(s: Snapshot): void {
    for (const [id, p] of s.pickups) {
      let v = this.pickupViews.get(id);
      if (!v) {
        v = this.makePickup(p);
        this.scene.add(v);
        this.pickupViews.set(id, v);
      }
      v.visible = p.active;
    }
  }

  private makePickup(p: SnapPickup): THREE.Object3D {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const model = buildWeaponModel(p.weapon as WeaponId);
    model.scale.setScalar(1.7);
    model.position.z = 0.4;
    g.add(model);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.55;
    g.add(halo);
    return g;
  }

  private syncProjectiles(s: Snapshot): void {
    for (const [id, p] of s.projectiles) {
      if (this.projViews.has(id)) continue;
      const v = this.makeProjectile(p.kind as ProjKind);
      v.position.set(p.x, p.y, p.z);
      this.scene.add(v);
      this.projViews.set(id, v);
    }
    for (const [id, v] of this.projViews) {
      if (!s.projectiles.has(id)) {
        this.scene.remove(v);
        this.projViews.delete(id);
      }
    }
  }

  private makeProjectile(kind: ProjKind): THREE.Object3D {
    switch (kind) {
      case ProjKind.Chicken: {
        const c = buildChicken();
        c.scale.setScalar(1.3);
        return c;
      }
      case ProjKind.Plunger: {
        const g = new THREE.Group();
        const cup = part(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xf25c54);
        cup.rotation.x = Math.PI / 2;
        cup.position.z = -0.45;
        const stick = part(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), 0xc98a4b);
        stick.rotation.x = Math.PI / 2;
        g.add(cup, stick);
        return g;
      }
      case ProjKind.Bubble:
        return new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshToonMaterial({ color: 0xbfefff, transparent: true, opacity: 0.55, depthWrite: false }));
      case ProjKind.Toast:
      default:
        return part(new THREE.BoxGeometry(0.5, 0.5, 0.12), 0xd99a52);
    }
  }

  private onEvent(e: GameEvent): void {
    const selfId = this.net.sessionId;
    switch (e.t) {
      case 'shot':
        if (e.by !== selfId) {
          this.fx.tracer(e.fx, e.fy, e.fz, e.tx, e.ty, e.tz, e.color);
          sfx.at('paint', e.fx, e.fy, e.fz, 0.45);
        }
        this.fx.splat(e.tx, e.ty, e.tz, e.color, e.hitWorld ? 4 : 2, 3);
        break;
      case 'hit': {
        this.fx.splat(e.x, e.y, e.z, e.color, 8, 5);
        const screen = this.project(e.x, e.y + 0.8, e.z);
        const mineShot = e.by === selfId;
        const onMe = e.victim === selfId;
        if (screen && (mineShot || onMe)) this.hud.damageNumber(screen.x + (Math.random() - 0.5) * 30, screen.y, e.dmg, onMe);
        if (mineShot && !onMe) {
          this.hud.hitmarker(false);
          sfx.play('hit', 0.6);
        }
        if (onMe) sfx.play('hurt', 0.7);
        this.remotes.get(e.victim)?.view.punch(3);
        break;
      }
      case 'boom': {
        this.fx.explosion(e.x, e.y, e.z, e.radius, e.color);
        sfx.at('boom', e.x, e.y, e.z);
        const d = this.camera.position.distanceTo(this.projV.set(e.x, e.y, e.z));
        if (d < RENDER.shakeMaxDistance) this.shake = Math.max(this.shake, RENDER.shakeExplosion * (1 - d / RENDER.shakeMaxDistance));
        break;
      }
      case 'kill': {
        const name = (id: string | null): string | null => (id ? (this.net.state.players.get(id)?.nick ?? '???') : null);
        this.hud.killfeed(name(e.by), name(e.victim) ?? '???', e.cause, e.by === selfId || e.victim === selfId);
        if (e.by === selfId && e.victim !== selfId) {
          this.hud.hitmarker(true);
          sfx.play('kill', 0.7);
        }
        const r = this.remotes.get(e.victim);
        if (r) {
          const pos = r.pos;
          sfx.at(e.cause === 'fall' ? 'poof' : 'death', pos.x, pos.y, pos.z, 0.8);
          if (e.cause === 'fall') this.fx.poof(pos.x, pos.y, pos.z, 24);
          else {
            const ground = raycastStatic(this.mw, pos, { x: 0, y: -1, z: 0 }, 40);
            const groundY = ground >= 0 ? pos.y - ground + 0.2 : this.mw.map.killY;
            this.fx.ragdoll(r.view.explodeIntoParts(), e.vx, e.vy, e.vz, groundY);
            this.fx.poof(pos.x, pos.y, pos.z);
          }
        }
        break;
      }
      case 'bubble': {
        const r = this.remotes.get(e.victim);
        if (r) sfx.at('bubble', r.pos.x, r.pos.y, r.pos.z);
        break;
      }
      case 'stick':
        sfx.at('stick', e.x, e.y, e.z);
        break;
      case 'launch': {
        const r = this.remotes.get(e.by);
        if (r && e.by !== selfId) sfx.at(LAUNCH_SOUND[e.weapon], r.pos.x, r.pos.y, r.pos.z, 0.8);
        break;
      }
      case 'pickup':
        if (e.id === selfId) {
          this.input.weaponSlot = e.weapon;
          sfx.play('pickup', 0.8);
        }
        break;
      case 'motor':
        if (e.id === selfId) break; // own moves were already predicted locally
        this.applyMotorFx(e.id, e.kind, e.v);
        break;
      case 'bump':
        this.remotes.get(e.id)?.view.punch(6);
        this.fx.poof(e.x, e.y, e.z, 4);
        break;
      default:
        break;
    }
  }

  private applyMotorFx(id: string, kind: string, v: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const { x, y, z } = r.pos;
    if (kind === 'jump' || kind === 'djump' || kind === 'pad') {
      r.view.punch(-8);
      sfx.at(kind === 'pad' ? 'pad' : 'jump', x, y, z, 0.5);
    }
    if (kind === 'land' || kind === 'bounce') {
      r.view.land(v);
      sfx.at(kind === 'bounce' ? 'jelly' : 'land', x, y, z, 0.5);
    }
    if (kind === 'dash') {
      this.fx.poof(x, y - 0.5, z, 5);
      sfx.at('dash', x, y, z, 0.5);
    }
  }

  private project(x: number, y: number, z: number): { x: number; y: number } | null {
    this.projV.set(x, y, z).project(this.camera);
    if (this.projV.z > 1) return null;
    return { x: (this.projV.x * 0.5 + 0.5) * innerWidth, y: (-this.projV.y * 0.5 + 0.5) * innerHeight };
  }

  /** Solve the fire direction: the bullet starts at the muzzle and must reach what the crosshair covers. */
  private solveAim(px: number, py: number, pz: number): void {
    const yaw = this.input.yaw;
    const pitch = this.input.pitch;
    const pivot = this.cameraPivot(px, py, pz);
    const dir = aimDirection(yaw, pitch);
    const dist = this.cameraDistance(pivot);
    const ox = pivot.x - dir.x * dist;
    const oy = pivot.y - dir.y * dist;
    const oz = pivot.z - dir.z * dist;
    let t = raycastStatic(this.mw, { x: ox + dir.x * dist, y: oy + dir.y * dist, z: oz + dir.z * dist }, dir, CAMERA.maxRayDistance);
    t = t >= 0 ? t + dist : CAMERA.maxRayDistance;
    for (const [id, r] of this.remotes) {
      if (id === this.net.sessionId || !r.view.root.visible) continue;
      const hit = rayCapsule(ox, oy, oz, dir.x, dir.y, dir.z, t, r.pos.x, r.pos.y, r.pos.z);
      if (hit >= 0 && hit > dist) t = hit;
    }
    const tx = ox + dir.x * t;
    const ty = oy + dir.y * t;
    const tz = oz + dir.z * t;
    const m = muzzleOf(px, py, pz, yaw);
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dz = tz - m.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.aimYaw = Math.atan2(-dx, -dz);
    this.aimPitch = Math.asin(dy / len);
  }

  private fixedTick(now: number): void {
    const seq = ++this.seq;
    const yaw = this.input.yaw;
    const s = this.predictor.state;
    this.solveAim(s.x, s.y, s.z);
    const b = this.input.locked ? this.input.buttons() : 0;
    const input: PlayerInput = {
      s: seq,
      mx: this.input.locked ? this.input.moveX() : 0,
      mz: this.input.locked ? this.input.moveZ() : 0,
      y: yaw,
      ay: this.aimYaw,
      ap: this.aimPitch,
      b,
      w: this.input.weaponSlot,
      v: Math.max(0, Math.round(this.net.renderTick(now))),
    };
    const alive = this.me?.alive ?? true;
    if (this.net.state.phase === 'countdown') input.b &= ~Btn.Fire;
    if (alive) this.onLocalMotor(this.predictor.step(input));
    else {
      this.predictor.pending.length = 0;
      this.predictor.prev.x = s.x;
      this.predictor.prev.y = s.y;
      this.predictor.prev.z = s.z;
    }
    if (alive && b & Btn.Fire) this.localFire();
    this.recent.push(input);
    if (this.recent.length > NET.inputRedundancy) this.recent.shift();
    this.net.sendInputs(this.recent);
  }

  private onLocalMotor(ev: MotorEvents): void {
    const r = this.remotes.get(this.net.sessionId);
    if (!r) return;
    if (ev.jumped || ev.doubleJumped || ev.padded) r.view.punch(-8);
    if (ev.landed > COMBAT.landEventMinSpeed) r.view.land(ev.landed);
    if (ev.dashed) this.fx.poof(this.predictor.state.x, this.predictor.state.y - 0.5, this.predictor.state.z, 5);
    if (ev.jumped || ev.doubleJumped) sfx.play('jump', 0.45, ev.doubleJumped ? 1.3 : 1);
    if (ev.padded) sfx.play('pad', 0.7);
    if (ev.bounced) sfx.play('jelly', 0.7);
    else if (ev.landed > COMBAT.landEventMinSpeed) sfx.play('land', 0.5);
    if (ev.dashed) sfx.play('dash', 0.6);
  }

  private localFire(): void {
    const me = this.me;
    if (!me) return;
    const def = WEAPONS[me.weapon];
    if (this.seq < this.localFireReady) return;
    this.localFireReady = this.seq + def.cooldownTicks;
    if (def.projectileSpeed === 0) {
      const s = this.predictor.state;
      const m = muzzleOf(s.x, s.y, s.z, this.input.yaw);
      const d = aimDirection(this.aimYaw, this.aimPitch);
      const wall = raycastStatic(this.mw, m, d, def.range);
      const t = wall >= 0 ? wall : def.range;
      this.fx.tracer(m.x, m.y, m.z, m.x + d.x * t, m.y + d.y * t, m.z + d.z * t, colorForTeam(me));
    }
    sfx.play(LAUNCH_SOUND[me.weapon], me.weapon === WeaponId.Paint ? 0.4 : 0.9);
    this.remotes.get(this.net.sessionId)?.view.punch(0.6);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(NET.maxFrameAccumulator, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.fixedTick(now);
    }
    this.predictor.decay(dt);
    this.predictor.renderPos(this.acc / TICK_DT, this.tmp);
    this.updateEntities(now, dt);
    this.fx.update(dt);
    this.updateCamera(dt);
    const st = this.net.state;
    const tick = st.tick as number;
    this.hud.update(this.me, dt, tick);
    this.updateTopHud(st);
    const last = this.net.snapshots[this.net.snapshots.length - 1];
    if (last) this.hud.scoreboard(this.input.scoreboard, [...last.players.values()], this.net.sessionId, MODES[st.mode as ModeId]?.teams ?? false);
    this.renderer.render(this.scene, this.camera);
  };

  private updateTopHud(st: any): void {
    const mode = st.mode as ModeId;
    const pill = (team: number, text: string): string => `<span style="color:#${TEAM_COLORS[team].toString(16)}">${text}</span>`;
    let a = '';
    let b = '';
    let obj = '';
    if (st.phase === 'countdown') obj = `<span class="big-count">${st.countdown}</span>`;
    switch (mode) {
      case 'tdm':
        a = pill(0, String(st.scoreA));
        b = pill(1, String(st.scoreB));
        if (!obj) obj = `Первыми до ${MATCH.tdmKillLimit}`;
        break;
      case 'paint': {
        const total = st.paintTotal || 1;
        a = pill(0, `${Math.round((100 * st.scoreA) / total)}%`);
        b = pill(1, `${Math.round((100 * st.scoreB) / total)}%`);
        if (!obj) obj = 'Закрашивай пол!';
        break;
      }
      case 'koth': {
        a = pill(0, String(st.scoreA));
        b = pill(1, String(st.scoreB));
        const hold = st.hillContested ? 'Гора оспаривается!' : st.hillOwner >= 0 ? `Гору держат: ${TEAM_NAMES[st.hillOwner]}` : 'Займи гору!';
        if (!obj) obj = hold;
        if (this.hillZone) {
          const color = st.hillContested ? 0xffd23f : st.hillOwner >= 0 ? TEAM_COLORS[st.hillOwner] : 0xffffff;
          (this.hillZone.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
        break;
      }
      default:
        if (!obj) obj = `Первый до ${MATCH.ffaKillLimit} киллов`;
    }
    this.hud.setTop(st.timeLeft, a, b, obj);
  }

  private updateEntities(now: number, dt: number): void {
    const selfId = this.net.sessionId;
    const b = bracket(this.net.snapshots, this.net.renderTick(now));
    for (const [id, r] of this.remotes) {
      const isMe = id === selfId;
      let snap: SnapPlayer | undefined;
      if (isMe) {
        snap = this.me;
        if (snap?.alive !== false) r.pos.set(this.tmp.x, this.tmp.y, this.tmp.z);
        const s = this.predictor.state;
        r.vel.set(s.vx, s.vy, s.vz);
      } else if (b) {
        const pa = b[0].players.get(id);
        const pb = b[1].players.get(id) ?? pa;
        if (pa && pb) {
          // Interpolation: positions are drawn ~100 ms in the past, between two real states.
          if (pa.teleport === pb.teleport) r.pos.set(pa.x + (pb.x - pa.x) * b[2], pa.y + (pb.y - pa.y) * b[2], pa.z + (pb.z - pa.z) * b[2]);
          else r.pos.set(pb.x, pb.y, pb.z);
          r.vel.set(pb.vx, pb.vy, pb.vz);
          snap = pb;
        }
      }
      if (!snap) continue;
      r.view.root.position.copy(r.pos);
      const nowBubble = isMe ? this.predictor.state.bubble > 0 : snap.bubble > 0;
      if (r.wasBubble && !nowBubble) this.fx.splat(r.pos.x, r.pos.y, r.pos.z, 0xbfefff, 14, 6);
      r.wasBubble = nowBubble;
      if (!r.wasAlive && snap.alive) this.fx.poof(r.pos.x, r.pos.y, r.pos.z, 8);
      r.wasAlive = snap.alive;
      r.view.update({
        dt,
        vx: r.vel.x,
        vy: r.vel.y,
        vz: r.vel.z,
        grounded: isMe ? this.predictor.state.grounded : snap.grounded,
        yaw: isMe ? this.input.yaw : snap.yaw,
        aimPitch: isMe ? this.input.pitch : snap.ap,
        weapon: snap.weapon,
        bubble: nowBubble,
        alive: snap.alive,
      });
    }
    if (b) {
      for (const [id, v] of this.propViews) {
        const pa = b[0].props.get(id);
        const pb = b[1].props.get(id) ?? pa;
        if (!pa || !pb) continue;
        v.position.set(pa.x + (pb.x - pa.x) * b[2], pa.y + (pb.y - pa.y) * b[2], pa.z + (pb.z - pa.z) * b[2]);
        v.quaternion.set(pb.qx, pb.qy, pb.qz, pb.qw);
      }
      for (const [id, v] of this.projViews) {
        const pb = b[1].projectiles.get(id) ?? b[0].projectiles.get(id);
        const pa = b[0].projectiles.get(id) ?? pb;
        if (!pa || !pb) continue;
        v.position.set(pa.x + (pb.x - pa.x) * b[2], pa.y + (pb.y - pa.y) * b[2], pa.z + (pb.z - pa.z) * b[2]);
        const speed = Math.hypot(pb.vx, pb.vy, pb.vz);
        if (speed > 0.1) v.lookAt(v.position.x + pb.vx, v.position.y + pb.vy, v.position.z + pb.vz);
        if (pb.kind === ProjKind.Chicken) this.fx.trail(v.position.x, v.position.y, v.position.z, 0xfff8e7);
      }
    }
    const t = now * 0.002;
    for (const v of this.pickupViews.values()) {
      v.rotation.y = t;
      v.children[0].position.y = Math.sin(t * 2) * 0.12;
    }
  }

  private cameraPivot(x: number, y: number, z: number): THREE.Vector3 {
    const yaw = this.input.yaw;
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const shoulder = CAMERA.shoulder + (CAMERA.aimShoulder - CAMERA.shoulder) * this.zoom;
    return this.pivot.set(x, y + CAMERA.height, z).addScaledVector(this.right, shoulder);
  }

  private cameraDistance(pivot: THREE.Vector3): number {
    const { yaw, pitch } = this.input;
    const d = aimDirection(yaw, pitch);
    const want = CAMERA.distance + (CAMERA.aimDistance - CAMERA.distance) * this.zoom;
    const hit = raycastStatic(this.mw, pivot, { x: -d.x, y: -d.y, z: -d.z }, want);
    return hit >= 0 ? Math.max(0.4, hit - CAMERA.collisionMargin) : want;
  }

  private updateCamera(dt: number): void {
    const aimed = this.input.aiming ? 1 : 0;
    this.zoom += (aimed - this.zoom) * Math.min(1, dt * CAMERA.zoomLerp);
    const d = aimDirection(this.input.yaw, this.input.pitch);
    const r = this.remotes.get(this.net.sessionId);
    const base = r ? r.pos : this.tmp;
    const pivot = this.cameraPivot(base.x, base.y, base.z);
    const dist = this.cameraDistance(pivot);
    this.forward.set(d.x, d.y, d.z);
    this.camera.position.copy(pivot).addScaledVector(this.forward, -dist);
    this.camera.lookAt(this.look.copy(pivot).addScaledVector(this.forward, 20));
    const fov = CAMERA.fov + (CAMERA.aimFov - CAMERA.fov) * this.zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-RENDER.shakeDecay * dt);
    }
    sfx.listener.x = this.camera.position.x;
    sfx.listener.y = this.camera.position.y;
    sfx.listener.z = this.camera.position.z;
    if (this.sun) {
      this.sun.position.set(base.x + 30, base.y + 60, base.z + 20);
      this.sun.target.position.set(base.x, base.y, base.z);
      this.sun.target.updateMatrixWorld();
    }
  }

  get debug(): { x: number; y: number; z: number; pending: number; corrections: number; err: number; views: number } {
    return { ...this.tmp, pending: this.predictor.pending.length, corrections: this.predictor.corrections, err: this.predictor.lastError, views: this.remotes.size };
  }

  get footOffset(): number {
    return CAPSULE_FOOT;
  }
}

function colorForTeam(p: SnapPlayer): number {
  return p.team >= 0 ? TEAM_COLORS[p.team] : colorForId(p.id);
}
