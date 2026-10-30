// Procedural cartoon characters built from Three.js primitives, animated in code:
// squash & stretch on a spring, run bobbing, blinking eyes that follow the aim.
import * as THREE from 'three';
import { CAPSULE_FOOT, CharacterId, RENDER, WEAPON_COUNT, WeaponId } from '@splat/shared';
import { makeNickname } from './nickname';
import { part, toon } from './toon';

const sph = (r: number, w = 18, h = 12): THREE.SphereGeometry => new THREE.SphereGeometry(r, w, h);
const cap = (r: number, l: number): THREE.CapsuleGeometry => new THREE.CapsuleGeometry(r, l, 6, 14);
const cyl = (r1: number, r2: number, h: number, seg = 18): THREE.CylinderGeometry => new THREE.CylinderGeometry(r1, r2, h, seg);
const cone = (r: number, h: number, seg = 14): THREE.ConeGeometry => new THREE.ConeGeometry(r, h, seg);
const box = (x: number, y: number, z: number): THREE.BoxGeometry => new THREE.BoxGeometry(x, y, z);

interface Eye {
  pivot: THREE.Group;
  pupil: THREE.Mesh;
  baseX: number;
  baseY: number;
}
interface Built {
  body: THREE.Group;
  eyes: Eye[];
  feet: THREE.Object3D[];
  hand: THREE.Group;
  height: number;
}

const WHITE = 0xffffff;
const DARK = 0x1d1b2e;

function addEyes(body: THREE.Group, y: number, z: number, spread: number, r: number): Eye[] {
  const eyes: Eye[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * spread, y, z);
    const white = part(sph(r), WHITE);
    pivot.add(white);
    const pupil = new THREE.Mesh(sph(r * 0.52, 10, 8), toon(DARK));
    pupil.position.z = -r * 0.62;
    pivot.add(pupil);
    body.add(pivot);
    eyes.push({ pivot, pupil, baseX: 0, baseY: 0 });
  }
  return eyes;
}

function addFeet(body: THREE.Group, color: number, spread: number, y: number, r = 0.2): THREE.Object3D[] {
  return [-1, 1].map((side) => {
    const foot = part(sph(r, 12, 8), color);
    foot.scale.set(1, 0.6, 1.4);
    foot.position.set(side * spread, y, -0.03);
    body.add(foot);
    return foot;
  });
}

function addHand(body: THREE.Group, color: number, x: number, y: number, z: number): THREE.Group {
  const hand = new THREE.Group();
  hand.position.set(x, y, z);
  const fist = part(sph(0.15, 10, 8), color);
  hand.add(fist);
  body.add(hand);
  const other = part(sph(0.14, 10, 8), color);
  other.position.set(-x, y - 0.08, z + 0.1);
  body.add(other);
  return hand;
}

function buildPelmen(): Built {
  const body = new THREE.Group();
  const C = 0xfff3d6;
  const b = part(sph(0.8, 26, 18), C);
  b.scale.set(1.12, 0.82, 1);
  b.position.y = 0.66;
  body.add(b);
  // The crimped ridge of a dumpling
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.85 + (i / 8) * Math.PI * 1.7;
    const knob = part(sph(0.16, 8, 6), 0xf3dcaa);
    knob.position.set(Math.sin(a) * 0.82, 0.68 + Math.cos(a) * 0.62, 0.08);
    body.add(knob);
  }
  const blush = new THREE.Mesh(sph(0.11, 8, 6), toon(0xffa3a3));
  blush.position.set(0.55, 0.52, -0.55);
  body.add(blush, blush.clone().translateX(-1.1));
  const eyes = addEyes(body, 0.82, -0.68, 0.26, 0.17);
  return { body, eyes, feet: addFeet(body, 0xf3dcaa, 0.36, 0.08, 0.24), hand: addHand(body, C, 0.78, 0.55, -0.35), height: 1.5 };
}

function buildCactus(): Built {
  const body = new THREE.Group();
  const C = 0x4fb35a;
  const trunk = part(cap(0.46, 0.75), C);
  trunk.position.y = 0.88;
  body.add(trunk);
  for (const side of [-1, 1]) {
    const arm = part(cap(0.15, 0.32), C);
    arm.position.set(side * 0.62, 0.98 + (side > 0 ? 0.14 : 0), 0);
    body.add(arm);
    const conn = part(cap(0.13, 0.15), C);
    conn.rotation.z = Math.PI / 2;
    conn.position.set(side * 0.5, 0.8 + (side > 0 ? 0.14 : 0), 0);
    body.add(conn);
  }
  // Spikes!
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const y = 0.45 + (i % 4) * 0.28;
    const spike = new THREE.Mesh(cone(0.05, 0.2, 6), toon(0xfff1a8));
    spike.position.set(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5);
    spike.lookAt(spike.position.clone().multiplyScalar(2));
    spike.rotateX(Math.PI / 2);
    body.add(spike);
  }
  const flower = part(sph(0.15, 8, 6), 0xff6fb5);
  flower.position.y = 1.72;
  body.add(flower);
  const eyes = addEyes(body, 1.1, -0.37, 0.18, 0.14);
  return { body, eyes, feet: addFeet(body, 0x3a8f46, 0.25, 0.08), hand: addHand(body, 0x3a8f46, 0.55, 0.62, -0.3), height: 1.75 };
}

function buildDuck(): Built {
  const body = new THREE.Group();
  const C = 0xffd23f;
  const b = part(sph(0.58, 20, 14), C);
  b.scale.set(1, 0.9, 1.1);
  b.position.y = 0.58;
  body.add(b);
  const head = part(sph(0.4), C);
  head.position.set(0, 1.18, -0.14);
  body.add(head);
  const beak = part(sph(0.22, 12, 8), 0xff8c42);
  beak.scale.set(1.1, 0.42, 1.2);
  beak.position.set(0, 1.12, -0.54);
  body.add(beak);
  const tail = part(cone(0.14, 0.3, 8), C);
  tail.rotation.x = -1;
  tail.position.set(0, 0.72, 0.6);
  body.add(tail);
  // Hard hat
  const hat = part(new THREE.SphereGeometry(0.44, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xff6f3c);
  hat.position.set(0, 1.3, -0.14);
  body.add(hat);
  const brim = part(cyl(0.54, 0.54, 0.05), 0xff6f3c);
  brim.position.set(0, 1.31, -0.18);
  body.add(brim);
  const eyes = addEyes(body, 1.25, -0.44, 0.17, 0.12);
  return { body, eyes, feet: addFeet(body, 0xff8c42, 0.25, 0.08), hand: addHand(body, C, 0.56, 0.62, -0.25), height: 1.75 };
}

function buildToaster(): Built {
  const body = new THREE.Group();
  const b = part(box(1.05, 0.85, 0.75), 0xbfd0dc);
  b.position.y = 0.72;
  body.add(b);
  const base = part(box(1.15, 0.12, 0.85), 0x5c6b7a);
  base.position.y = 0.27;
  body.add(base);
  for (const x of [-0.24, 0.24]) {
    const toast = part(box(0.14, 0.42, 0.55), 0xd99a52);
    toast.position.set(x, 1.17, 0);
    body.add(toast);
  }
  const lever = part(box(0.08, 0.28, 0.08), 0xf25c54);
  lever.position.set(0.58, 0.72, 0);
  body.add(lever);
  const antenna = part(cyl(0.02, 0.02, 0.3, 6), DARK);
  antenna.position.set(-0.4, 1.3, 0.2);
  body.add(antenna);
  const tip = part(sph(0.07, 8, 6), 0xff4fa3);
  tip.position.set(-0.4, 1.47, 0.2);
  body.add(tip);
  const eyes = addEyes(body, 0.85, -0.4, 0.22, 0.15);
  return { body, eyes, feet: addFeet(body, 0x5c6b7a, 0.34, 0.08), hand: addHand(body, 0x5c6b7a, 0.72, 0.62, -0.2), height: 1.5 };
}

function buildJelly(): Built {
  const body = new THREE.Group();
  const C = 0xff6fb5;
  const b = part(cyl(0.55, 0.72, 1.05, 22), C);
  b.position.y = 0.55;
  body.add(b);
  const top = part(sph(0.55, 22, 10), C);
  top.scale.y = 0.55;
  top.position.y = 1.07;
  body.add(top);
  const cherry = part(sph(0.17, 12, 8), 0xe5193f);
  cherry.position.y = 1.46;
  body.add(cherry);
  const stem = part(cyl(0.02, 0.02, 0.28, 6), 0x4caf50);
  stem.rotation.z = 0.5;
  stem.position.set(0.06, 1.66, 0);
  body.add(stem);
  const eyes = addEyes(body, 0.9, -0.54, 0.22, 0.15);
  return { body, eyes, feet: [], hand: addHand(body, 0xffa6d4, 0.7, 0.55, -0.25), height: 1.55 };
}

function buildBaursak(): Built {
  const body = new THREE.Group();
  const C = 0xd98b3a;
  const b = part(sph(0.58, 20, 14), C);
  b.scale.set(1.06, 0.92, 1);
  b.position.y = 0.72;
  body.add(b);
  // Fried crust patches + powdered sugar
  for (const [x, y, z] of [[0.3, 1.0, -0.35], [-0.42, 0.85, 0.2], [0.05, 1.22, 0.1], [0.4, 0.6, 0.3], [-0.2, 0.45, -0.45]] as const) {
    const sugar = new THREE.Mesh(sph(0.09, 8, 6), toon(0xfff3d6));
    sugar.position.set(x, y, z);
    body.add(sugar);
  }
  const eyes = addEyes(body, 0.88, -0.48, 0.2, 0.15);
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const leg = part(cap(0.06, 0.2), 0x7a4a1f);
    leg.position.set(side * 0.22, 0.16, 0);
    body.add(leg);
    legs.push(leg);
  }
  return { body, eyes, feet: legs, hand: addHand(body, 0xa66421, 0.58, 0.68, -0.3), height: 1.4 };
}

// ---- friends as big-headed caricatures --------------------------------------------
const SKIN = 0xf2c6a0;
const HEAD_Y = 1.02;
const HEAD_R = 0.56;

interface FaceOpts {
  shirt: number;
  headScaleX?: number;
  eyeSquint?: number;
  glance?: number;
}

function buildCaricatureBase(o: FaceOpts): Built {
  const body = new THREE.Group();
  const torso = part(cap(0.3, 0.2), o.shirt);
  torso.position.y = 0.42;
  body.add(torso);
  const head = part(sph(HEAD_R, 24, 16), SKIN);
  head.scale.set(o.headScaleX ?? 1, 1.04, 0.96);
  head.position.y = HEAD_Y;
  body.add(head);
  for (const side of [-1, 1]) {
    const ear = part(sph(0.12, 10, 8), SKIN);
    ear.scale.set(0.6, 1, 0.8);
    ear.position.set(side * HEAD_R * (o.headScaleX ?? 1), HEAD_Y - 0.02, 0.02);
    body.add(ear);
  }
  const nose = part(sph(0.09, 10, 8), 0xe8b48c, false);
  nose.scale.set(1.1, 0.9, 1);
  nose.position.set(0, HEAD_Y - 0.09, -HEAD_R * 0.97);
  body.add(nose);
  const eyes = addEyes(body, HEAD_Y + 0.05, -HEAD_R * 0.8, 0.21, 0.125);
  for (const e of eyes) {
    e.pivot.children[0].scale.y = o.eyeSquint ?? 0.7;
    e.pupil.position.x = o.glance ?? 0;
  }
  return { body, eyes, feet: addFeet(body, 0x2a2a35, 0.2, 0.08), hand: addHand(body, SKIN, 0.42, 0.42, -0.25), height: 1.65 };
}

function addMouth(body: THREE.Group, tilt = 0, width = 0.12, color = 0xd98a8a): void {
  const lips = new THREE.Mesh(sph(width, 10, 6), toon(color));
  lips.scale.set(1, 0.32, 0.5);
  lips.position.set(0, HEAD_Y - 0.26, -HEAD_R * 0.86);
  lips.rotation.z = tilt;
  body.add(lips);
}

function addBrows(body: THREE.Group, color: number, angle: number): void {
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(box(0.2, 0.045, 0.05), toon(color));
    brow.position.set(side * 0.21, HEAD_Y + 0.21, -HEAD_R * 0.88);
    brow.rotation.z = side * angle;
    body.add(brow);
  }
}

function addGlasses(body: THREE.Group, w = 0.2, h = 0.15): void {
  const frame = toon(DARK);
  const y = HEAD_Y + 0.05;
  const z = -HEAD_R * 0.95;
  const bar = (sx: number, sy: number, sz: number, px: number, py: number, pz: number): void => {
    const m = new THREE.Mesh(box(sx, sy, sz), frame);
    m.position.set(px, py, pz);
    body.add(m);
  };
  const t = 0.035;
  for (const side of [-1, 1]) {
    const cx = side * 0.2;
    bar(w + t, t, t, cx, y + h / 2, z);
    bar(w + t, t, t, cx, y - h / 2, z);
    bar(t, h, t, cx - w / 2, y, z);
    bar(t, h, t, cx + w / 2, y, z);
    bar(t, t, 0.5, side * (0.2 + w / 2), y + h / 2, z + 0.25);
  }
  bar(0.09, t, t, 0, y + 0.03, z);
}

/** Dark hair mass plus a mop of cones; each lock is [x, y, z, tiltX, tiltZ, length]. */
function addLocks(body: THREE.Group, color: number, locks: readonly (readonly [number, number, number, number, number, number])[], r = 0.13): void {
  for (const [x, y, z, rx, rz, len] of locks) {
    const lock = part(cone(r, len, 8), color);
    lock.position.set(x, HEAD_Y + y, z);
    lock.rotation.set(rx, 0, rz);
    body.add(lock);
  }
}

function addHairCap(body: THREE.Group, color: number, r = HEAD_R * 1.06, lift = 0.04): void {
  const hair = part(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), color);
  hair.position.set(0, HEAD_Y + lift, 0.03);
  hair.rotation.x = 0.32; // front edge up off the forehead, back edge down the neck
  body.add(hair);
}

function buildFringe(): Built {
  const b = buildCaricatureBase({ shirt: 0x34452f, eyeSquint: 0.72 });
  const HAIR = 0x2a211d;
  addHairCap(b.body, HAIR);
  // The signature uneven, messy fringe hanging into the eyes
  addLocks(b.body, HAIR, [
    [-0.34, 0.3, -0.4, Math.PI - 0.25, -0.2, 0.26],
    [-0.16, 0.33, -0.46, Math.PI - 0.2, -0.05, 0.3],
    [0.03, 0.34, -0.48, Math.PI - 0.15, 0.1, 0.24],
    [0.2, 0.33, -0.46, Math.PI - 0.2, 0.05, 0.32],
    [0.37, 0.28, -0.38, Math.PI - 0.25, 0.25, 0.26],
    [-0.5, 0.05, -0.1, Math.PI, -0.1, 0.34],
    [0.5, 0.05, -0.1, Math.PI, 0.1, 0.34],
  ]);
  addBrows(b.body, HAIR, -0.12);
  addMouth(b.body, 0, 0.13);
  // Chunky knit collar
  const collar = part(new THREE.TorusGeometry(0.27, 0.075, 8, 18), 0x45583f);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.66;
  b.body.add(collar);
  return b;
}

function buildProf(): Built {
  const b = buildCaricatureBase({ shirt: 0x24242c, eyeSquint: 0.62, glance: 0.02 });
  const HAIR = 0x2b211c;
  const SUN = 0xa8733a; // the sunlit tips
  addHairCap(b.body, HAIR);
  addLocks(b.body, HAIR, [
    [-0.3, 0.52, -0.1, -0.2, 0.45, 0.42],
    [0.0, 0.62, -0.12, -0.25, 0, 0.46],
    [0.3, 0.5, -0.1, -0.2, -0.5, 0.42],
    [-0.15, 0.55, 0.2, 0.3, 0.3, 0.42],
    [0.2, 0.55, 0.2, 0.3, -0.3, 0.42],
    [-0.38, 0.34, -0.36, Math.PI - 0.5, -0.3, 0.2],
    [0.36, 0.32, -0.36, Math.PI - 0.5, 0.3, 0.2],
  ]);
  addLocks(b.body, SUN, [
    [-0.1, 0.72, -0.2, -0.35, 0.15, 0.2],
    [0.17, 0.72, -0.16, -0.3, -0.25, 0.2],
    [0.42, 0.56, -0.05, -0.1, -0.75, 0.2],
  ], 0.06);
  addGlasses(b.body);
  addBrows(b.body, HAIR, 0.08);
  addMouth(b.body, 0.14, 0.12); // that small smirk
  return b;
}

function buildCapGuy(): Built {
  const b = buildCaricatureBase({ shirt: 0x1f1f26, headScaleX: 1.1, eyeSquint: 0.68, glance: 0.04 });
  const CAP = 0x17171d;
  const dome = part(new THREE.SphereGeometry(HEAD_R * 1.1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), CAP);
  dome.scale.x = 1.08;
  dome.position.set(0, HEAD_Y + 0.14, 0.02);
  b.body.add(dome);
  const button_ = new THREE.Mesh(sph(0.05, 8, 6), toon(0x33333d));
  button_.position.set(0, HEAD_Y + 0.76, 0.02);
  b.body.add(button_);
  const brim = part(cyl(0.42, 0.42, 0.05, 24), CAP);
  brim.scale.set(1.05, 1, 1.15);
  brim.rotation.x = 0.18;
  brim.position.set(0.08, HEAD_Y + 0.2, -0.56);
  b.body.add(brim);
  // Short sideburns under the cap
  addLocks(b.body, 0x2a211d, [
    [-0.6, 0.02, 0.02, Math.PI, 0, 0.2],
    [0.6, 0.02, 0.02, Math.PI, 0, 0.2],
  ], 0.06);
  addGlasses(b.body, 0.21, 0.15);
  addMouth(b.body, -0.1, 0.12);
  // Chubby cheek squished into a fist: forever lost in thought
  const cheek = part(sph(0.17, 12, 8), 0xf0bb95, false);
  cheek.position.set(-0.45, HEAD_Y - 0.22, -0.25);
  b.body.add(cheek);
  const fist = part(sph(0.15, 10, 8), SKIN);
  fist.position.set(-0.55, HEAD_Y - 0.42, -0.28);
  b.body.add(fist);
  const forearm = part(cap(0.075, 0.32), 0xf2c6a0);
  forearm.rotation.z = 0.5;
  forearm.position.set(-0.65, HEAD_Y - 0.66, -0.22);
  b.body.add(forearm);
  return b;
}

const BUILDERS: Record<CharacterId, () => Built> = { fringe: buildFringe, prof: buildProf, capguy: buildCapGuy, pelmen: buildPelmen, cactus: buildCactus, duck: buildDuck, toaster: buildToaster, jelly: buildJelly, baursak: buildBaursak };

// ---- weapon models -----------------------------------------------------------------
export function buildWeaponModel(w: WeaponId): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    const m = part(geo, color);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
    return m;
  };
  switch (w) {
    case WeaponId.Paint:
      add(cyl(0.09, 0.11, 0.5), 0x2ec4ff, 0, 0, -0.3, Math.PI / 2);
      add(sph(0.14, 10, 8), 0xff4fa3, 0, 0.15, -0.15);
      add(cyl(0.04, 0.04, 0.16, 8), 0xffd23f, 0, 0, -0.62, Math.PI / 2);
      break;
    case WeaponId.Plunger:
      add(cyl(0.035, 0.035, 0.7, 8), 0xc98a4b, 0, 0, -0.3, Math.PI / 2);
      add(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xf25c54, 0, 0, -0.68, Math.PI / 2);
      break;
    case WeaponId.Chicken: {
      add(cyl(0.16, 0.2, 0.75), 0x7ae582, 0, 0, -0.25, Math.PI / 2);
      const chick = buildChicken();
      chick.scale.setScalar(0.45);
      chick.position.set(0, 0, -0.68);
      g.add(chick);
      break;
    }
    case WeaponId.Bubble:
      add(cyl(0.12, 0.08, 0.4), 0xb388ff, 0, 0, -0.2, Math.PI / 2);
      add(new THREE.TorusGeometry(0.14, 0.03, 8, 16), 0x4dd0c4, 0, 0, -0.46);
      break;
  }
  return g;
}

export function buildChicken(): THREE.Group {
  const g = new THREE.Group();
  const b = part(sph(0.34, 14, 10), 0xfff8e7);
  b.scale.set(0.9, 0.9, 1.3);
  g.add(b);
  const head = part(sph(0.16, 10, 8), 0xfff8e7);
  head.position.set(0, 0.2, -0.42);
  g.add(head);
  const comb = part(sph(0.08, 8, 6), 0xf25c54);
  comb.position.set(0, 0.36, -0.42);
  g.add(comb);
  const beak = part(cone(0.06, 0.14, 8), 0xffb347);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.18, -0.6);
  g.add(beak);
  return g;
}

// ---- runtime view ------------------------------------------------------------------
export interface AnimInput {
  dt: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  yaw: number;
  aimPitch: number;
  weapon: number;
  bubble: boolean;
  alive: boolean;
}

export class CharacterView {
  readonly root = new THREE.Group();
  private built: Built;
  private tilt = new THREE.Group();
  private squash = 0;
  private squashV = 0;
  private phase = Math.random() * 10;
  private blinkIn = RENDER.blinkMinSec + Math.random() * 2;
  private blinkT = 0;
  private weapons: THREE.Group[] = [];
  private bubbleMesh: THREE.Mesh | null = null;
  private ring: THREE.Mesh;
  private shownYaw = 0;
  nick: THREE.Sprite | null = null;

  constructor(readonly char: CharacterId, teamColor: number, nick?: string) {
    this.built = BUILDERS[char]();
    this.built.body.position.y = -CAPSULE_FOOT;
    this.tilt.add(this.built.body);
    this.root.add(this.tilt);
    for (let w = 0; w < WEAPON_COUNT; w++) {
      const m = buildWeaponModel(w as WeaponId);
      m.visible = w === 0;
      this.built.hand.add(m);
      this.weapons.push(m);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: teamColor }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -CAPSULE_FOOT + 0.05;
    this.ring = ring;
    this.root.add(ring);
    if (nick) {
      const color = '#' + teamColor.toString(16).padStart(6, '0');
      this.nick = makeNickname(nick, color);
      this.nick.position.y = RENDER.nicknameHeight;
      this.root.add(this.nick);
    }
  }

  /** Kick the squash spring: positive = flatten, negative = stretch. */
  punch(amount: number): void {
    this.squashV += amount;
  }

  land(speed: number): void {
    const jelly = this.char === 'jelly' ? 2 : 1;
    this.punch(Math.min(16, speed * 0.7) * jelly);
  }

  update(a: AnimInput): void {
    const { dt } = a;
    // Spring
    const k = this.char === 'jelly' ? 120 : 180;
    const damp = this.char === 'jelly' ? 7 : 14;
    this.squashV += (-k * this.squash - damp * this.squashV) * dt;
    this.squash += this.squashV * dt;
    this.squash = Math.max(-0.45, Math.min(0.6, this.squash));

    const speed = Math.hypot(a.vx, a.vz);
    const air = a.grounded ? 0 : Math.max(-0.2, Math.min(0.22, a.vy * 0.012));
    const s = this.squash - air;
    const sy = 1 - s;
    const sxz = 1 + s * 0.55;
    const body = this.built.body;
    body.scale.set(sxz, sy, sxz);

    // Turn smoothly toward the camera yaw
    let diff = a.yaw - this.shownYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.shownYaw += diff * Math.min(1, dt * 18);
    this.tilt.rotation.y = this.shownYaw;

    // Run wobble
    const running = a.grounded && speed > 0.5;
    this.phase += dt * (running ? 3 + speed * 1.2 : 2);
    const amp = running ? Math.min(1, speed / 8) : 0;
    this.tilt.rotation.z = Math.sin(this.phase) * 0.14 * amp;
    this.tilt.rotation.x = -0.1 * amp;
    body.position.y = -CAPSULE_FOOT + Math.abs(Math.sin(this.phase)) * 0.14 * amp;
    this.built.feet.forEach((f, i) => {
      f.position.z = Math.sin(this.phase + i * Math.PI) * 0.26 * amp - 0.03;
    });

    // Aim: hand and weapon follow pitch, pupils track it too
    this.built.hand.rotation.x = a.aimPitch;
    const blink = this.tickBlink(dt);
    for (const e of this.built.eyes) {
      e.pivot.scale.y = blink;
      e.pupil.position.y = Math.max(-0.05, Math.min(0.05, a.aimPitch * 0.08));
    }

    for (let w = 0; w < WEAPON_COUNT; w++) this.weapons[w].visible = w === a.weapon;

    // Bubble wobble
    if (a.bubble) {
      if (!this.bubbleMesh) {
        this.bubbleMesh = new THREE.Mesh(sph(1.25, 20, 14), new THREE.MeshToonMaterial({ color: 0xbfefff, transparent: true, opacity: 0.45, depthWrite: false }));
        this.root.add(this.bubbleMesh);
      }
      this.bubbleMesh.visible = true;
      const t = performance.now() * 0.006;
      this.bubbleMesh.scale.set(1 + Math.sin(t) * 0.06, 1 + Math.cos(t) * 0.06, 1 + Math.sin(t + 1) * 0.06);
      this.tilt.rotation.z = Math.sin(t * 0.7) * 0.3;
    } else if (this.bubbleMesh) this.bubbleMesh.visible = false;

    this.root.visible = a.alive;
  }

  private tickBlink(dt: number): number {
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = RENDER.blinkDurationSec;
      this.blinkIn = RENDER.blinkMinSec + Math.random() * (RENDER.blinkMaxSec - RENDER.blinkMinSec);
    }
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      return 0.1;
    }
    return 1;
  }

  /** Clone the visible toon meshes into loose pieces for the death ragdoll. */
  explodeIntoParts(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.root.updateMatrixWorld(true);
    this.built.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.isOutline) return;
      const copy = new THREE.Mesh(m.geometry, m.material);
      m.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      copy.castShadow = true;
      out.push(copy);
    });
    return out;
  }

  setTeamColor(color: number): void {
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
