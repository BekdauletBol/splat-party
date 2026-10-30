// Maps are pure data built from primitives: the server and the client read the
// same definition, so colliders and visuals can never drift apart.
import { WeaponId } from './constants';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Prim {
  shape: 'box' | 'cyl' | 'sphere' | 'cone';
  p: Vec3;
  /** box: full size; cyl/cone: [radius, height, radius]; sphere: [radius, r, r]. */
  s: Vec3;
  q?: Quat;
  color: number;
  solid: boolean;
}

export interface BoxZone {
  center: Vec3;
  half: Vec3;
}
export interface JumpPad extends BoxZone {
  power: number; // multiplier of PHYS.jumpPadSpeed
}
export interface SpeedStrip extends BoxZone {
  dir: [number, number]; // normalized xz
}
export interface Waypoint {
  p: Vec3;
  links: number[];
  jump?: boolean;
}
export interface PropSpawn {
  kind: 'ball' | 'crate';
  p: Vec3;
  radius: number;
  color: number;
}
export interface PickupSpawn {
  p: Vec3;
  weapon: WeaponId;
}
export interface MapDef {
  id: string;
  name: string;
  desc: string;
  skyTop: number;
  skyBottom: number;
  fog: number;
  killY: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  prims: Prim[];
  pads: JumpPad[];
  strips: SpeedStrip[];
  sand: BoxZone[];
  spawns: Vec3[];
  pickups: PickupSpawn[];
  waypoints: Waypoint[];
  hill: { p: Vec3; radius: number };
  props: PropSpawn[];
}

// ---- small quaternion helpers ------------------------------------------------
export function quatY(a: number): Quat {
  return [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
}
export function quatZ(a: number): Quat {
  return [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
}
export function quatX(a: number): Quat {
  return [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
}
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// ---- builder -------------------------------------------------------------------
const box = (p: Vec3, s: Vec3, color: number, q?: Quat, solid = true): Prim => ({ shape: 'box', p, s, q, color, solid });
const cyl = (p: Vec3, radius: number, height: number, color: number, q?: Quat, solid = true): Prim => ({ shape: 'cyl', p, s: [radius, height, radius], q, color, solid });
const sphere = (p: Vec3, radius: number, color: number, solid = true): Prim => ({ shape: 'sphere', p, s: [radius, radius, radius], color, solid });
const cone = (p: Vec3, radius: number, height: number, color: number, q?: Quat, solid = true): Prim => ({ shape: 'cone', p, s: [radius, height, radius], q, color, solid });

/** A box whose top surface runs exactly from `from` to `to`. */
function ramp(from: Vec3, to: Vec3, width: number, thick: number, color: number): Prim {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const pitch = Math.asin(dy / len);
  const yaw = Math.atan2(-dz, dx);
  const q = quatMul(quatY(yaw), quatZ(pitch));
  // Centre sits half a thickness below the top surface, along the box normal.
  const nx = -Math.sin(pitch) * Math.cos(yaw);
  const ny = Math.cos(pitch);
  const nz = Math.sin(pitch) * Math.sin(yaw);
  return box(
    [(from[0] + to[0]) / 2 - (nx * thick) / 2, (from[1] + to[1]) / 2 - (ny * thick) / 2, (from[2] + to[2]) / 2 - (nz * thick) / 2],
    [len, thick, width],
    color,
    q,
  );
}

function link(wps: Waypoint[], pairs: [number, number][]): void {
  for (const [a, b] of pairs) {
    wps[a].links.push(b);
    wps[b].links.push(a);
  }
}
const wp = (x: number, y: number, z: number, jump = false): Waypoint => ({ p: [x, y, z], links: [], jump });

// ---- Кухня великанов ---------------------------------------------------------------
function buildKitchen(): MapDef {
  const prims: Prim[] = [];
  const WHITE = 0xfdfbf3;
  const RIM = 0x7cc6fe;
  const STEEL = 0xbfd0dc;
  // The table far below is only scenery: falling off the plate is a "poof".
  prims.push(box([0, -26, 0], [190, 2, 190], 0xf4a259, undefined, false));
  prims.push(box([0, -24.9, 0], [70, 0.2, 70], 0xe94f64, undefined, false));
  prims.push(box([-75, -14, -70], [8, 22, 8], 0xd98b4a, undefined, false));
  // Giant plate
  prims.push(cyl([0, -1, 0], 20, 2, WHITE));
  prims.push(cyl([0, -2.6, 0], 12, 1.4, RIM));
  // A soup of olive hills on the plate
  prims.push(sphere([-9, -1.6, 8], 3.2, 0x7ae582));
  prims.push(sphere([9, -1.8, -8], 3.4, 0xf25c54));
  // A meatball hill in the middle hosts the King-of-the-hill zone
  prims.push(cyl([0, 0.5, 0], 6, 1, 0xc97b4b));
  prims.push(cyl([0, 1.5, 0], 3.8, 1, 0xdb8d5b));
  prims.push(ramp([0, 0, 9.5], [0, 1, 6], 3, 0.6, 0xdb8d5b));
  prims.push(ramp([0, 0, -9.5], [0, 1, -6], 3, 0.6, 0xdb8d5b));
  prims.push(ramp([0, 1, 5.5], [0, 2, 3.5], 2.4, 0.6, 0xe9a06d));
  prims.push(ramp([0, 1, -5.5], [0, 2, -3.5], 2.4, 0.6, 0xe9a06d));
  // Saucers
  prims.push(cyl([38, -1, 0], 12, 2, 0xffe08a));
  prims.push(cyl([-38, -1, 0], 12, 2, 0xc3f0ca));
  prims.push(cyl([0, -1, 38], 11, 2, 0xffc9de));
  prims.push(cyl([0, -1, -38], 11, 2, 0xd9c8ff));
  // Fork bridges: handle + tines
  const fork = (ax: number, az: number, bx: number, bz: number): void => {
    const y = -0.02;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const handleEnd = 0.62;
    prims.push(ramp([ax, y, az], [ax + ux * len * handleEnd, y, az + uz * len * handleEnd], 2.6, 0.5, STEEL));
    const px = -uz;
    const pz = ux;
    for (const off of [-1.4, -0.47, 0.47, 1.4]) {
      prims.push(
        ramp(
          [ax + ux * len * handleEnd + px * off, y, az + uz * len * handleEnd + pz * off],
          [bx + px * off, y, bz + pz * off],
          0.72,
          0.4,
          STEEL,
        ),
      );
    }
    prims.push(ramp([ax + ux * len * (handleEnd - 0.04) - px * 1.8, y, az + uz * len * (handleEnd - 0.04) - pz * 1.8], [ax + ux * len * (handleEnd - 0.04) + px * 1.8, y, az + uz * len * (handleEnd - 0.04) + pz * 1.8], 1.6, 0.45, STEEL));
  };
  fork(18.5, 0, 28, 0);
  fork(-18.5, 0, -28, 0);
  fork(0, 18.5, 0, 29);
  fork(0, -18.5, 0, -29);
  // Cups as cover
  prims.push(cyl([-12, 1.5, -11], 2.3, 3, 0xff8c42));
  prims.push(cyl([12, 1.5, 11], 2.3, 3, 0x4dd0c4));
  prims.push(cone([-13, 4.2, -11], 0.8, 2.6, 0xfff1a8, undefined, false));
  // Cheese wedge ramp on the east saucer
  prims.push(ramp([33, 0, -6], [40, 3.2, -6], 7, 0.8, 0xffd23f));
  prims.push(box([43, 1.5, -6], [6, 3.4, 7], 0xffd23f));
  // Broccoli forest on the west saucer
  for (const [x, z] of [[-42, 5], [-34, -6], [-44, -5]] as const) {
    prims.push(cyl([x, 1.3, z], 0.7, 2.6, 0x68b35a));
    prims.push(sphere([x, 3.4, z], 1.8, 0x3f9b4f));
  }
  // Salt shaker on the north saucer, pepper on the south one
  prims.push(cyl([4, 2, 38], 1.5, 4, 0xfff));
  prims.push(cyl([-4, 2, -38], 1.5, 4, 0x4a4a55));
  // Spoon platform up high
  prims.push(cyl([0, 8, 0], 3.2, 0.5, STEEL));
  prims.push(box([0, 8, 7], [1.1, 0.35, 8], STEEL));

  const pads: JumpPad[] = [
    { center: [14, 0.2, -3], half: [1.7, 0.6, 1.7], power: 1 },
    { center: [-14, 0.2, 3], half: [1.7, 0.6, 1.7], power: 1 },
    { center: [3, 2.2, 0], half: [1, 0.6, 1], power: 0.9 },
    { center: [38, 0.2, 7], half: [1.7, 0.6, 1.7], power: 0.85 },
    { center: [-38, 0.2, -7], half: [1.7, 0.6, 1.7], power: 0.85 },
  ];
  const JELLY = 0xff6fb5;
  for (const pad of pads) {
    prims.push(cyl([pad.center[0], pad.center[1] - 0.1, pad.center[2]], pad.half[0], 0.5, JELLY, undefined, false));
    prims.push(sphere([pad.center[0], pad.center[1] + 0.1, pad.center[2]], pad.half[0] * 0.55, 0xffa6d4, false));
  }

  const strips: SpeedStrip[] = [
    { center: [0, 0.1, 14], half: [1.6, 0.6, 4], dir: [0, 1] },
    { center: [0, 0.1, -14], half: [1.6, 0.6, 4], dir: [0, -1] },
    { center: [33, 0.1, 6], half: [4, 0.6, 1.4], dir: [-1, 0] },
  ];
  for (const s of strips) prims.push(box([s.center[0], 0.03, s.center[2]], [s.half[0] * 2, 0.06, s.half[2] * 2], 0x8dffb0, undefined, false));

  const waypoints: Waypoint[] = [
    wp(0, 2, 0), // 0 hill top
    wp(0, 1, 7.5), // 1
    wp(0, 1, -7.5), // 2
    wp(12, 0, 0), // 3
    wp(-12, 0, 0), // 4
    wp(9, 0, 12), // 5
    wp(-9, 0, 13), // 6
    wp(9, 0, -13), // 7
    wp(-8, 0, -12), // 8
    wp(23, 0, 0), // 9 fork E
    wp(-23, 0, 0), // 10 fork W
    wp(0, 0, 23), // 11 fork N
    wp(0, 0, -23), // 12 fork S
    wp(36, 0, 0), // 13 E saucer
    wp(-36, 0, 0), // 14 W saucer
    wp(0, 0, 36), // 15 N saucer
    wp(0, 0, -36), // 16 S saucer
    wp(40, 3, -6), // 17 cheese top
    wp(-42, 0, 0), // 18
    wp(-38, 0, -7), // 19 pad
    wp(-3, 0, 41), // 20
  ];
  link(waypoints, [
    [0, 1], [0, 2], [1, 5], [1, 6], [2, 7], [2, 8], [3, 5], [3, 7], [4, 6], [4, 8], [3, 9], [4, 10], [5, 11], [6, 11], [7, 12], [8, 12],
    [9, 13], [10, 14], [11, 15], [12, 16], [13, 17], [14, 18], [14, 19], [15, 20],
  ]);

  return {
    id: 'kitchen',
    name: 'Кухня великанов',
    desc: 'Гигантская тарелка, вилки-мосты и батуты-желе',
    skyTop: 0x7ed6ff,
    skyBottom: 0xfff4d6,
    fog: 0xcfeefc,
    killY: -14,
    bounds: { minX: -52, maxX: 52, minZ: -52, maxZ: 52 },
    prims,
    pads,
    strips,
    sand: [],
    spawns: [
      [12, 1, 7], [-12, 1, -7], [8, 1, -14], [-8, 1, 15], [36, 1, 5], [-36, 1, 5], [4, 1, 35], [-4, 1, -35],
      [16, 1, -6], [-16, 1, 6],
    ],
    pickups: [
      { p: [0, 3, 0], weapon: WeaponId.Chicken },
      { p: [40, 4.2, -6], weapon: WeaponId.Plunger },
      { p: [-40, 1, 3], weapon: WeaponId.Bubble },
      { p: [0, 1, 40], weapon: WeaponId.Chicken },
      { p: [0, 1, -40], weapon: WeaponId.Plunger },
      { p: [0, 9.2, 0], weapon: WeaponId.Bubble },
    ],
    waypoints,
    hill: { p: [0, 2, 0], radius: 5.5 },
    props: [
      { kind: 'ball', p: [-5, 3, 16], radius: 1.4, color: 0xf25c54 },
      { kind: 'ball', p: [5, 3, -16], radius: 1.2, color: 0x7ae582 },
      { kind: 'crate', p: [36, 2, 6], radius: 0.8, color: 0xc98a4b },
      { kind: 'crate', p: [-36, 2, -5], radius: 0.8, color: 0xc98a4b },
    ],
  };
}

// ---- Детская площадка -------------------------------------------------------------
function buildPlayground(): MapDef {
  const prims: Prim[] = [];
  const GRASS = 0x8ed15e;
  const WOOD = 0xc98a4b;
  // Grass island
  prims.push(box([0, -1, 0], [76, 2, 76], GRASS));
  prims.push(box([0, -22, 0], [300, 2, 300], 0x74c7ec, undefined, false));
  // Sandbox: low wooden frame, sand slows you down
  prims.push(box([-18, 0.02, -16], [15, 0.05, 15], 0xf5dd8c, undefined, false));
  for (const [x, z, sx, sz] of [[-18, -8.2, 15.6, 0.6], [-18, -23.8, 15.6, 0.6], [-10.2, -16, 0.6, 15], [-25.8, -16, 0.6, 15]] as const) {
    prims.push(box([x, 0.15, z], [sx, 0.3, sz], WOOD));
  }
  prims.push(cone([-20, 1.1, -18], 3.2, 2.2, 0xf0cf73));
  prims.push(cyl([-15, 0.6, -13], 0.9, 1.2, 0xff6f91));
  // Big slide tower
  prims.push(box([18, 3, -16], [7, 0.5, 7], 0xffd23f));
  for (const [x, z] of [[15, -19], [21, -19], [15, -13], [21, -13]] as const) prims.push(cyl([x, 1.4, z], 0.4, 2.8, 0x4dd0c4));
  prims.push(ramp([14.5, 3.25, -16], [4, 0, -16], 3.4, 0.4, 0xff4fa3)); // slide (west)
  prims.push(box([4, 0.4, -14.1], [10, 0.8, 0.3], 0xff4fa3, undefined, false));
  prims.push(ramp([18, 0, -6], [18, 3.25, -12.5], 3, 0.4, 0x7cc6fe)); // stairs ramp (south)
  prims.push(cone([18, 5.9, -16], 5, 3, 0xf25c54));
  // Seesaws (tilted planks: they don't swing physically but launch via pads)
  const see = (x: number, z: number, color: number): void => {
    prims.push(cyl([x, 0.5, z], 0.7, 1, 0x7a5c3e));
    prims.push(ramp([x - 5, 0.1, z], [x + 5, 2.3, z], 2.2, 0.35, color));
  };
  see(-14, 14, 0xb388ff);
  see(4, 18, 0xff8c42);
  // Swing frame
  for (const x of [15, 27]) {
    prims.push(ramp([x, 0, 8.5], [x, 7, 12], 0.5, 0.5, 0x4a90d9));
    prims.push(ramp([x, 0, 15.5], [x, 7, 12], 0.5, 0.5, 0x4a90d9));
  }
  prims.push(box([21, 7, 12], [12.6, 0.5, 0.5], 0x4a90d9));
  prims.push(box([18, 1.4, 12], [1.8, 0.2, 1], WOOD, undefined, false));
  prims.push(box([24, 1.4, 12], [1.8, 0.2, 1], WOOD, undefined, false));
  // Climbing dome at the centre (King of the hill)
  prims.push(cyl([0, 0.5, 0], 6.5, 1, 0x6dd3ce));
  prims.push(cyl([0, 1.5, 0], 4.5, 1, 0x9be564));
  prims.push(ramp([8.5, 0, 0], [6, 1, 0], 3, 0.4, 0xffd23f));
  prims.push(ramp([-8.5, 0, 0], [-6, 1, 0], 3, 0.4, 0xffd23f));
  prims.push(ramp([6, 1, 0], [4, 2, 0], 2.4, 0.4, 0xffe08a));
  prims.push(ramp([-6, 1, 0], [-4, 2, 0], 2.4, 0.4, 0xffe08a));
  // Trees and blocks for cover
  for (const [x, z] of [[-30, 28], [30, -30], [32, 28], [-30, 8], [32, -4]] as const) {
    prims.push(cyl([x, 1.8, z], 0.8, 3.6, 0x8a6240));
    prims.push(sphere([x, 5, z], 2.8, 0x4caf50));
  }
  for (const [x, z, c, s] of [
    [-5, -22, 0xf25c54, 3], [-1, -24, 0xffd23f, 2.4], [-3.2, -21, 0x4dd0c4, 2], [28, 28, 0xb388ff, 3], [-27, -2, 0xff8c42, 2.5], [8, 30, 0x7cc6fe, 3],
  ] as const) {
    prims.push(box([x, s / 2, z], [s, s, s], c));
  }

  const pads: JumpPad[] = [
    { center: [-27, 0.2, 18], half: [1.7, 0.6, 1.7], power: 1 },
    { center: [10, 0.2, 2], half: [1.7, 0.6, 1.7], power: 0.8 },
    { center: [-3, 0.2, -12], half: [1.7, 0.6, 1.7], power: 1 },
    { center: [30, 0.2, 2], half: [1.7, 0.6, 1.7], power: 1 },
  ];
  for (const pad of pads) {
    prims.push(cyl([pad.center[0], 0.15, pad.center[2]], pad.half[0], 0.3, 0x333a56, undefined, false));
    prims.push(cyl([pad.center[0], 0.33, pad.center[2]], pad.half[0] * 0.85, 0.06, 0xff6fb5, undefined, false));
  }
  const strips: SpeedStrip[] = [
    { center: [-3, 0.1, 28], half: [10, 0.6, 1.5], dir: [1, 0] },
    { center: [0.5, 0.2, -16], half: [3.2, 0.8, 1.6], dir: [-1, 0] },
    { center: [-32, 0.1, -2], half: [1.5, 0.6, 12], dir: [0, 1] },
  ];
  for (const s of strips) prims.push(box([s.center[0], 0.03, s.center[2]], [s.half[0] * 2, 0.06, s.half[2] * 2], 0x8dffb0, undefined, false));

  const waypoints: Waypoint[] = [
    wp(0, 2, 0), // 0 dome
    wp(9, 0, 0), // 1
    wp(-9, 0, 0), // 2
    wp(4, 0, -9), // 3 below slide exit
    wp(18, 0, -5), // 4 stairs bottom
    wp(18, 3.2, -15), // 5 slide tower
    wp(-9, 0, -5), // 6
    wp(-18, 0, -16), // 7 sandbox
    wp(-9, 0, 10), // 8
    wp(-14, 1.2, 14), // 9 seesaw
    wp(4, 1.2, 18), // 10 seesaw
    wp(20, 0, 6), // 11
    wp(21, 0, 18), // 12
    wp(4, 0, 26), // 13
    wp(-22, 0, 27), // 14
    wp(-27, 0, 8), // 15
    wp(30, 0, -12), // 16
    wp(-4, 0, -30), // 17
    wp(14, 0, -27), // 18
    wp(-30, 0, -28), // 19
  ];
  link(waypoints, [
    [0, 1], [0, 2], [1, 3], [1, 11], [2, 6], [2, 8], [3, 4], [3, 6], [4, 5], [4, 11], [6, 7], [8, 9], [8, 15], [8, 13], [10, 13], [10, 11],
    [11, 12], [12, 13], [13, 14], [14, 15], [15, 6], [11, 16], [16, 18], [18, 17], [17, 19], [19, 7], [3, 18], [17, 3], [4, 16],
  ]);

  return {
    id: 'playground',
    name: 'Детская площадка',
    desc: 'Горки, качели, песочница и вечное лето',
    skyTop: 0x5ec8ff,
    skyBottom: 0xe7fbff,
    fog: 0xc7efff,
    killY: -12,
    bounds: { minX: -39, maxX: 39, minZ: -39, maxZ: 39 },
    prims,
    pads,
    strips,
    sand: [{ center: [-18, 0.5, -16], half: [7.5, 1.5, 7.5] }],
    spawns: [
      [28, 1, 20], [-28, 1, -8], [10, 1, -30], [-16, 1, 30], [34, 1, -18], [-34, 1, 32], [4, 1, 10], [-4, 1, -8],
      [24, 1, -3], [-20, 1, 6],
    ],
    pickups: [
      { p: [0, 3, 0], weapon: WeaponId.Chicken },
      { p: [18, 4.3, -16], weapon: WeaponId.Plunger },
      { p: [-18, 1, -11], weapon: WeaponId.Bubble },
      { p: [21, 1, 21], weapon: WeaponId.Chicken },
      { p: [-30, 1, 22], weapon: WeaponId.Plunger },
      { p: [20, 1, 28], weapon: WeaponId.Bubble },
    ],
    waypoints,
    hill: { p: [0, 2, 0], radius: 5.5 },
    props: [
      { kind: 'ball', p: [12, 5, -16], radius: 1.1, color: 0xff4fa3 },
      { kind: 'ball', p: [-4, 1.6, 26], radius: 1.4, color: 0xffd23f },
      { kind: 'crate', p: [-2, 1, -18], radius: 0.8, color: 0xc98a4b },
      { kind: 'crate', p: [-22, 1, 3], radius: 0.8, color: 0xc98a4b },
      { kind: 'ball', p: [24, 2, 4], radius: 1, color: 0x7cc6fe },
    ],
  };
}

export const MAPS: Record<string, MapDef> = {
  kitchen: buildKitchen(),
  playground: buildPlayground(),
};
export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'kitchen';
