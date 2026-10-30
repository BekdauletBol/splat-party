import { MapSchema, Schema, type } from '@colyseus/schema';
import { DEFAULT_MAP, MATCH } from '@splat/shared';

export class PlayerS extends Schema {
  @type('string') id = '';
  @type('string') nick = '';
  @type('string') char = 'pelmen';
  @type('int8') team = -1;
  @type('boolean') isBot = false;
  @type('boolean') ready = false;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') vx = 0;
  @type('float32') vy = 0;
  @type('float32') vz = 0;
  @type('float32') yaw = 0;
  @type('float32') ay = 0;
  @type('float32') ap = 0;
  @type('boolean') grounded = false;
  @type('uint8') jumpsUsed = 0;
  @type('uint8') coyote = 0;
  @type('uint8') dashCd = 0;
  @type('uint8') dashT = 0;
  @type('float32') dashX = 0;
  @type('float32') dashZ = 0;
  @type('boolean') jumpHeld = false;
  @type('boolean') dashHeld = false;
  @type('uint8') bubble = 0;
  @type('uint32') lastSeq = 0;
  @type('uint8') teleport = 0;
  @type('int16') hp = 100;
  @type('int16') maxHp = 100;
  @type('boolean') alive = true;
  @type('uint8') weapon = 0;
  @type('uint8') ammo1 = 0;
  @type('uint8') ammo2 = 0;
  @type('uint8') ammo3 = 0;
  @type('uint16') kills = 0;
  @type('uint16') deaths = 0;
  @type('int32') score = 0;
  @type('uint32') respawnAt = 0;
  @type('boolean') firing = false;
  @type('boolean') aiming = false;
  @type('boolean') plungered = false;
  @type('float32') plungerX = 0;
  @type('float32') plungerY = 0;
  @type('float32') plungerZ = 0;
}

export class ProjectileS extends Schema {
  @type('uint16') id = 0;
  @type('uint8') kind = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') vx = 0;
  @type('float32') vy = 0;
  @type('float32') vz = 0;
  @type('string') owner = '';
  @type('boolean') stuck = false;
}

export class PropS extends Schema {
  @type('uint16') id = 0;
  @type('string') kind = 'ball';
  @type('float32') radius = 1;
  @type('uint32') color = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') qx = 0;
  @type('float32') qy = 0;
  @type('float32') qz = 0;
  @type('float32') qw = 1;
}

export class PickupS extends Schema {
  @type('uint16') id = 0;
  @type('uint8') weapon = 0;
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('boolean') active = true;
}

export class GameState extends Schema {
  @type('uint32') tick = 0;
  @type('string') code = '';
  @type('string') phase = 'lobby'; // lobby | countdown | playing | results
  @type('string') mode = 'ffa';
  @type('string') map = DEFAULT_MAP;
  @type('string') host = '';
  @type('uint8') maxPlayers = MATCH.maxPlayers;
  @type('uint8') botCount = MATCH.defaultBots;
  @type('uint8') difficulty = 1;
  @type('boolean') isPrivate = false;
  @type('boolean') quick = false;
  @type('uint16') timeLeft = MATCH.durationSec;
  @type('uint8') countdown = 0;
  @type('int32') scoreA = 0;
  @type('int32') scoreB = 0;
  @type('int8') hillOwner = -1;
  @type('boolean') hillContested = false;
  @type({ map: PlayerS }) players = new MapSchema<PlayerS>();
  @type({ map: ProjectileS }) projectiles = new MapSchema<ProjectileS>();
  @type({ map: PropS }) props = new MapSchema<PropS>();
  @type({ map: PickupS }) pickups = new MapSchema<PickupS>();
}
