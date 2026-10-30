// Single source of truth for every gameplay number. No magic numbers elsewhere.
// PHYS is mutable on purpose: the dev panel (lil-gui) tunes it live and the
// server re-broadcasts the change, so prediction stays in sync.

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SERVER_PORT = 2567;

export const PHYS = {
  gravity: 30,
  jumpSpeed: 12,
  doubleJumpSpeed: 11,
  moveSpeed: 9,
  groundAccel: 90,
  airAccel: 26,
  groundFriction: 9,
  airFriction: 0.5,
  maxFallSpeed: 45,
  coyoteTicks: 4,
  dashSpeed: 24,
  dashTicks: 5,
  dashCooldownTicks: 45,
  jumpPadSpeed: 24,
  speedStripAccel: 70,
  speedStripMax: 22,
  sandSpeedMul: 0.55,
  knockbackHitscan: 1.4,
  knockbackExplosion: 24,
  knockbackUpBias: 0.45,
  selfExplosionMul: 1.0,
  plungerPullSpeed: 20,
  bubbleRiseSpeed: 3.5,
  jellyBounce: 0.55,
  jellyBounceMinSpeed: 12,
  propBumpSpeed: 16,
  propImpulse: 6,
  playerPushSpeed: 3.5,
};
export type PhysKey = keyof typeof PHYS;

/** Slider ranges for the dev panel: [min, max, step]. */
export const PHYS_RANGES: Record<PhysKey, [number, number, number]> = {
  gravity: [5, 60, 0.5],
  jumpSpeed: [4, 25, 0.5],
  doubleJumpSpeed: [4, 25, 0.5],
  moveSpeed: [2, 20, 0.25],
  groundAccel: [10, 200, 5],
  airAccel: [0, 100, 1],
  groundFriction: [0, 30, 0.5],
  airFriction: [0, 5, 0.1],
  maxFallSpeed: [10, 100, 1],
  coyoteTicks: [0, 15, 1],
  dashSpeed: [5, 60, 1],
  dashTicks: [1, 20, 1],
  dashCooldownTicks: [0, 150, 5],
  jumpPadSpeed: [5, 60, 1],
  speedStripAccel: [0, 200, 5],
  speedStripMax: [5, 60, 1],
  sandSpeedMul: [0.1, 1, 0.05],
  knockbackHitscan: [0, 10, 0.1],
  knockbackExplosion: [0, 80, 1],
  knockbackUpBias: [0, 1.5, 0.05],
  selfExplosionMul: [0, 3, 0.1],
  plungerPullSpeed: [2, 60, 1],
  bubbleRiseSpeed: [0, 15, 0.5],
  jellyBounce: [0, 1, 0.05],
  jellyBounceMinSpeed: [1, 40, 1],
  propBumpSpeed: [0, 50, 1],
  propImpulse: [0, 30, 1],
  playerPushSpeed: [0, 20, 0.5],
};

export const CAPSULE = {
  radius: 0.5,
  halfHeight: 0.45,
  skin: 0.02,
  stepHeight: 0.4,
  stepMinWidth: 0.15,
  snapDistance: 0.25,
  maxClimbDeg: 50,
  minSlideDeg: 40,
};
export const CAPSULE_FOOT = CAPSULE.radius + CAPSULE.halfHeight;

export const CAMERA = {
  distance: 5,
  shoulder: 1.05,
  height: 1.15,
  aimDistance: 3,
  aimShoulder: 0.95,
  fov: 72,
  aimFov: 50,
  minPitch: -1.35,
  maxPitch: 1.35,
  collisionMargin: 0.25,
  zoomLerp: 12,
  sensitivityDefault: 0.0024,
  maxRayDistance: 200,
};

export const NET = {
  interpDelayMs: 100,
  maxRewindMs: 300,
  historyTicks: 24,
  inputRedundancy: 3,
  maxPendingInputs: 90,
  maxInputsPerTick: 4,
  inputBudgetCap: 8,
  idleTicksBeforeAutoStep: 6,
  smoothCorrectionRate: 14,
  snapCorrectionDistance: 4,
  correctionEpsilon: 0.001,
  maxFrameAccumulator: 0.25,
  snapshotBuffer: 32,
};

export const MATCH = {
  durationSec: 300,
  respawnSec: 3,
  maxPlayers: 8,
  minPlayers: 2,
  defaultBots: 3,
  codeLength: 5,
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  ffaKillLimit: 25,
  tdmKillLimit: 40,
  kothScoreLimit: 120,
  kothScorePerSec: 1,
  quickStartDelaySec: 3,
  quickRestartDelaySec: 15,
  spawnProtectTicks: 45,
  fallSelfDeathPenalty: 1,
  maxNickLength: 16,
  countdownSec: 3,
};

export const PAINT = {
  cellSize: 1,
  brushHitscan: 1.3,
  brushExplosion: 3.5,
  brushBubble: 1.8,
  brushPlunger: 1.3,
  brushDeath: 2.5,
  brushWalkDash: 1.2,
  broadcastEveryTicks: 3,
  rayStartY: 60,
  rayLength: 90,
  minNormalY: 0.5,
};

export const PROPS = {
  crateHalf: 0.8,
  friction: 0.6,
  restitution: 0.5,
  density: 0.6,
  linearDamping: 0.12,
  angularDamping: 0.3,
  respawnBelowMargin: 2,
  kickEveryTicks: 180,
  kickSpeed: 7,
  bumpCooldownTicks: 15,
};

export const COMBAT = {
  contactHitCooldownTicks: 15,
  cactusContactDamage: 6,
  overlapRadius: 1.15,
  headshotMul: 1,
  toastTtlTicks: 120,
  toastSpeed: 16,
  toastDamage: 12,
  toastBounciness: 0.7,
  toastRadius: 0.3,
  toastGravity: 18,
  aimSpreadMul: 0.35,
  pickupRadius: 1.5,
  pickupRespawnSec: 15,
  muzzleForward: 0.6,
  muzzleHeight: 0.35,
  muzzleRight: 0.35,
  plungerStickTicks: 30,
  plungerStopDistance: 1.6,
  bubbleTicks: 45,
};

export const enum WeaponId {
  Paint = 0,
  Plunger = 1,
  Chicken = 2,
  Bubble = 3,
}
export const WEAPON_COUNT = 4;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  cooldownTicks: number;
  damage: number;
  spread: number;
  pickupAmmo: number; // -1 = infinite
  range: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileGravity: number;
  projectileTtlTicks: number;
  explosionRadius: number;
  knockback: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: WeaponId.Paint, name: 'Краскострел', icon: '🎨', cooldownTicks: 3, damage: 9, spread: 0.022, pickupAmmo: -1, range: 80, projectileSpeed: 0, projectileRadius: 0, projectileGravity: 0, projectileTtlTicks: 0, explosionRadius: 0, knockback: 1 },
  { id: WeaponId.Plunger, name: 'Вантузомёт', icon: '🪠', cooldownTicks: 24, damage: 15, spread: 0.005, pickupAmmo: 8, range: 0, projectileSpeed: 32, projectileRadius: 0.35, projectileGravity: 6, projectileTtlTicks: 60, explosionRadius: 0, knockback: 0 },
  { id: WeaponId.Chicken, name: 'Куриная базука', icon: '🐔', cooldownTicks: 30, damage: 70, spread: 0, pickupAmmo: 6, range: 0, projectileSpeed: 17, projectileRadius: 0.45, projectileGravity: 0, projectileTtlTicks: 120, explosionRadius: 5, knockback: 1 },
  { id: WeaponId.Bubble, name: 'Пузырь-пушка', icon: '🫧', cooldownTicks: 36, damage: 5, spread: 0.01, pickupAmmo: 6, range: 0, projectileSpeed: 15, projectileRadius: 0.55, projectileGravity: -1, projectileTtlTicks: 90, explosionRadius: 0, knockback: 0 },
];

export type CharacterId = 'pelmen' | 'cactus' | 'duck' | 'toaster' | 'jelly' | 'baursak';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  passive: string;
  hp: number;
  speedMul: number;
  knockbackMul: number;
  jumpMul: number;
  maxJumps: number;
  bouncy: boolean;
  thorns: boolean;
  toastDash: boolean;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  pelmen: { id: 'pelmen', name: 'Пельмень', passive: 'Тяжёлый: меньше отлетает, но бегает медленнее', hp: 130, speedMul: 0.86, knockbackMul: 0.5, jumpMul: 0.95, maxJumps: 1, bouncy: false, thorns: false, toastDash: false },
  cactus: { id: 'cactus', name: 'Кеша Кактус', passive: 'Шипы: касание ранит врага', hp: 100, speedMul: 1, knockbackMul: 1, jumpMul: 1, maxJumps: 1, bouncy: false, thorns: true, toastDash: false },
  duck: { id: 'duck', name: 'Утка в каске', passive: 'Двойной прыжок', hp: 100, speedMul: 1, knockbackMul: 1, jumpMul: 1, maxJumps: 2, bouncy: false, thorns: false, toastDash: false },
  toaster: { id: 'toaster', name: 'Тостер-бот', passive: 'Дэш выбрасывает прыгучий тост', hp: 100, speedMul: 1, knockbackMul: 1, jumpMul: 1, maxJumps: 1, bouncy: false, thorns: false, toastDash: true },
  jelly: { id: 'jelly', name: 'Желе', passive: 'Прыгает выше и пружинит при приземлении', hp: 100, speedMul: 1, knockbackMul: 1.15, jumpMul: 1.3, maxJumps: 1, bouncy: true, thorns: false, toastDash: false },
  baursak: { id: 'baursak', name: 'Баурсак', passive: 'Самый быстрый, но хрупкий', hp: 75, speedMul: 1.22, knockbackMul: 1.1, jumpMul: 1, maxJumps: 1, bouncy: false, thorns: false, toastDash: false },
};
export const CHARACTER_IDS = Object.keys(CHARACTERS) as CharacterId[];

export type ModeId = 'ffa' | 'tdm' | 'paint' | 'koth';
export const MODES: Record<ModeId, { name: string; desc: string; teams: boolean }> = {
  ffa: { name: 'Все против всех', desc: 'Каждый сам за себя. Побеждает лучший по киллам.', teams: false },
  tdm: { name: 'Командный бой', desc: 'Две команды, общий счёт киллов.', teams: true },
  paint: { name: 'Покраска', desc: 'Закрасьте больше пола цветом своей команды.', teams: true },
  koth: { name: 'Царь горы', desc: 'Удерживайте зону, чтобы копить очки.', teams: true },
};
export const MODE_IDS = Object.keys(MODES) as ModeId[];

export const TEAM_COLORS = [0xff4fa3, 0x2ec4ff] as const;
export const TEAM_NAMES = ['Розовые', 'Голубые'] as const;
export const FFA_COLORS = [0xff4fa3, 0x2ec4ff, 0xffd23f, 0x7ae582, 0xb388ff, 0xff8c42, 0x4dd0c4, 0xf25c54];

export type BotDifficulty = 0 | 1 | 2;
export const BOT_LEVELS = [
  { name: 'Лёгкие', reactionTicks: 24, spread: 0.13, aggression: 0.35, retreatHp: 0.2, aimTurn: 0.12 },
  { name: 'Средние', reactionTicks: 12, spread: 0.065, aggression: 0.6, retreatHp: 0.3, aimTurn: 0.22 },
  { name: 'Злые', reactionTicks: 5, spread: 0.025, aggression: 0.9, retreatHp: 0.35, aimTurn: 0.4 },
] as const;

export const BOT = {
  sightRange: 34,
  fireRange: 26,
  bazookaMinRange: 7,
  pickupSeekRange: 22,
  waypointReach: 1.6,
  stuckTicks: 45,
  stuckMoveEpsilon: 0.5,
  thinkEveryTicks: 3,
  healthRetreatCooldownTicks: 120,
  paintScanCells: 24,
  jumpRandomChance: 0.006,
  dashChance: 0.006,
  fireBurstTicks: 30,
  fireRestTicks: 15,
  names: ['Котлета 3000', 'Дядя Вантуз', 'Сырник-Убийца', 'Бабка Гранат', 'Шашлык Иваныч', 'Мистер Огурчик', 'Тётя Кетчуп', 'Хинкалище', 'Лаваш Лавашович', 'Кибер-Пирожок', 'Гриша Майонез', 'Ёжик в Мазуте', 'Компот', 'Товарищ Сосиска', 'Манты Прайм', 'Чак-Чак Норрис'],
};

export const RENDER = {
  outlineWidth: 0.035,
  shadowMapSize: { low: 0, medium: 1024, high: 2048 },
  pixelRatioCap: { low: 1, medium: 1.5, high: 2 },
  shadowFrustum: 45,
  maxParticles: 500,
  maxPaintSplats: 6000,
  blinkMinSec: 1.8,
  blinkMaxSec: 5,
  blinkDurationSec: 0.13,
  nicknameHeight: 1.75,
  ragdollLifeSec: 3,
  shakeDecay: 7,
  shakeExplosion: 0.5,
  shakeHit: 0.12,
  shakeMaxDistance: 22,
  damageNumberLifeSec: 0.9,
  killfeedLifeSec: 6,
  hitmarkerSec: 0.14,
};

export const AUDIO = {
  defaultVolume: 0.6,
  maxHearDistance: 45,
};

export const ALLOW_TUNE_ENV = 'SPLAT_ALLOW_TUNE';
