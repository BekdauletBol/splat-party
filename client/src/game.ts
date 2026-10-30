// In-match client: fixed-tick prediction, snapshot interpolation, camera.
import * as THREE from 'three';
import { CAMERA, CAPSULE_FOOT, CharacterId, MAPS, MSG, MotorWorld, NET, PlayerInput, RENDER, SnapPlayer, TICK_DT, buildMapWorld, raycastStatic } from '@splat/shared';
import { InputState } from './input';
import { Connection, Snapshot, bracket } from './net/connection';
import { Predictor } from './net/predictor';
import { buildMapView, buildSky } from './render/mapView';
import { makeNickname } from './render/nickname';
import { part } from './render/toon';

interface RemoteView {
  group: THREE.Group;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 800);
  private input: InputState;
  private mw!: MotorWorld;
  private predictor!: Predictor;
  private views = new Map<string, RemoteView>();
  private seq = 0;
  private acc = 0;
  private lastFrame = performance.now();
  private recent: PlayerInput[] = [];
  private tmp = { x: 0, y: 0, z: 0 };
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private look = new THREE.Vector3();
  private mapGroup?: THREE.Object3D;
  private running = false;

  constructor(private canvas: HTMLCanvasElement, private net: Connection) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatioCap.high));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new InputState(canvas);
    addEventListener('resize', this.resize);
    this.resize();
    canvas.addEventListener('click', () => this.input.lock());
    net.onSnapshot = (s) => this.onSnapshot(s);
  }

  private resize = (): void => {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  };

  loadMap(id: string): void {
    const map = MAPS[id];
    this.mw = buildMapWorld(map);
    this.scene.fog = new THREE.Fog(map.fog, 70, 240);
    this.mapGroup = buildMapView(map);
    this.scene.add(buildSky(map), this.mapGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a890, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER.shadowMapSize.high, RENDER.shadowMapSize.high);
    const f = RENDER.shadowFrustum + 10;
    Object.assign(sun.shadow.camera, { left: -f, right: f, top: f, bottom: -f, far: 160 });
    this.scene.add(sun);
    this.predictor = new Predictor(this.mw, 'pelmen');
  }

  start(): void {
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private onSnapshot(s: Snapshot): void {
    const me = s.players.get(this.net.sessionId);
    if (me) {
      this.predictor.char = me.char as CharacterId;
      this.predictor.reconcile(me);
    }
    for (const [id, p] of s.players) if (!this.views.has(id)) this.addView(id, p);
    for (const [id, v] of this.views) {
      if (!s.players.has(id)) {
        this.scene.remove(v.group);
        this.views.delete(id);
      }
    }
  }

  private addView(id: string, p: SnapPlayer): void {
    const group = new THREE.Group();
    const color = 0xff4fa3 + (Math.abs(hash(id)) % 0xffff);
    const body = part(new THREE.SphereGeometry(0.72, 20, 14), id === this.net.sessionId ? 0xffd23f : color & 0xffffff);
    body.position.y = 0.72 - CAPSULE_FOOT;
    group.add(body);
    if (id !== this.net.sessionId) {
      const nick = makeNickname(p.nick);
      nick.position.y = RENDER.nicknameHeight;
      group.add(nick);
    }
    this.scene.add(group);
    this.views.set(id, { group });
  }

  private fixedTick(): void {
    const seq = ++this.seq;
    const yaw = this.input.yaw;
    const input: PlayerInput = {
      s: seq,
      mx: this.input.moveX(),
      mz: this.input.moveZ(),
      y: yaw,
      ay: yaw,
      ap: this.input.pitch,
      b: this.input.buttons(),
      w: this.input.weaponSlot,
      v: Math.max(0, Math.round(this.net.renderTick(performance.now()))),
    };
    this.predictor.step(input);
    this.recent.push(input);
    if (this.recent.length > NET.inputRedundancy) this.recent.shift();
    this.net.sendInputs(this.recent);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(NET.maxFrameAccumulator, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.fixedTick();
    }
    this.predictor.decay(dt);
    this.predictor.renderPos(this.acc / TICK_DT, this.tmp);

    const b = bracket(this.net.snapshots, this.net.renderTick(now));
    for (const [id, v] of this.views) {
      if (id === this.net.sessionId) {
        v.group.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      } else if (b) {
        const pa = b[0].players.get(id);
        const pb = b[1].players.get(id) ?? pa;
        if (pa && pb) v.group.position.set(pa.x + (pb.x - pa.x) * b[2], pa.y + (pb.y - pa.y) * b[2], pa.z + (pb.z - pa.z) * b[2]);
      }
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };

  private updateCamera(): void {
    const { yaw, pitch } = this.input;
    this.forward.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.pivot.set(this.tmp.x, this.tmp.y + CAMERA.height, this.tmp.z).addScaledVector(this.right, CAMERA.shoulder);
    const hit = raycastStatic(this.mw, this.pivot, { x: -this.forward.x, y: -this.forward.y, z: -this.forward.z }, CAMERA.distance);
    const dist = hit >= 0 ? Math.max(0.4, hit - CAMERA.collisionMargin) : CAMERA.distance;
    this.camera.position.copy(this.pivot).addScaledVector(this.forward, -dist);
    this.camera.lookAt(this.look.copy(this.pivot).addScaledVector(this.forward, 20));
  }

  get debug(): { x: number; y: number; z: number; pending: number; corrections: number; err: number; views: number } {
    return { ...this.tmp, pending: this.predictor.pending.length, corrections: this.predictor.corrections, err: this.predictor.lastError, views: this.views.size };
  }
  get tuneChannel(): (key: string, value: number) => void {
    return (key, value) => this.net.send(MSG.Tune, { key, value });
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
