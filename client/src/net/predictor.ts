// Client-side prediction: runs the shared motor locally, then on each server
// snapshot rewinds to the authoritative state and replays unacknowledged inputs.
import { CharacterId, MotorState, MotorWorld, NET, PlayerInput, SnapPlayer, TICK_DT, copyMotorState, makeMotorState, stepMotor } from '@splat/shared';

export class Predictor {
  state: MotorState = makeMotorState();
  prev = { x: 0, y: 0, z: 0 };
  /** Visual-only error being smoothed away (render = predicted + offset). */
  offset = { x: 0, y: 0, z: 0 };
  pending: PlayerInput[] = [];
  private teleport = -1;
  private lastAck = -1;
  corrections = 0;
  lastError = 0;

  constructor(private mw: MotorWorld, public char: CharacterId) {}

  step(input: PlayerInput): ReturnType<typeof stepMotor> {
    this.pending.push(input);
    if (this.pending.length > NET.maxPendingInputs) this.pending.shift();
    this.prev.x = this.state.x;
    this.prev.y = this.state.y;
    this.prev.z = this.state.z;
    return stepMotor(this.state, input, this.char, this.mw);
  }

  reconcile(p: SnapPlayer): void {
    const teleported = p.teleport !== this.teleport;
    this.teleport = p.teleport;
    if (p.lastSeq === this.lastAck && !teleported && this.pending.length > 0 && !this.changedSinceAck(p)) return;
    this.lastAck = p.lastSeq;

    const s = this.state;
    const oldX = s.x;
    const oldY = s.y;
    const oldZ = s.z;
    copyMotorState(p, s);
    while (this.pending.length && this.pending[0].s <= p.lastSeq) this.pending.shift();
    for (const input of this.pending) stepMotor(s, input, this.char, this.mw);

    const ex = oldX - s.x;
    const ey = oldY - s.y;
    const ez = oldZ - s.z;
    const err = Math.hypot(ex, ey, ez);
    this.lastError = err;
    if (teleported || err > NET.snapCorrectionDistance) {
      this.offset.x = this.offset.y = this.offset.z = 0;
      this.prev.x = s.x;
      this.prev.y = s.y;
      this.prev.z = s.z;
    } else if (err > NET.correctionEpsilon) {
      this.corrections++;
      this.offset.x += ex;
      this.offset.y += ey;
      this.offset.z += ez;
    }
  }

  // Same ack, but the server may still have pushed us (knockback, bubble...).
  private lastVx = 0;
  private lastVy = 0;
  private lastVz = 0;
  private changedSinceAck(p: SnapPlayer): boolean {
    const changed = p.vx !== this.lastVx || p.vy !== this.lastVy || p.vz !== this.lastVz;
    this.lastVx = p.vx;
    this.lastVy = p.vy;
    this.lastVz = p.vz;
    return changed;
  }

  /** Decay the visual error. Call once per rendered frame. */
  decay(dt: number): void {
    const k = Math.exp(-NET.smoothCorrectionRate * dt);
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.z *= k;
  }

  /** Rendered position: interpolated between the last two fixed ticks, plus smoothing. */
  renderPos(alpha: number, out: { x: number; y: number; z: number }): void {
    const s = this.state;
    out.x = this.prev.x + (s.x - this.prev.x) * alpha + this.offset.x;
    out.y = this.prev.y + (s.y - this.prev.y) * alpha + this.offset.y;
    out.z = this.prev.z + (s.z - this.prev.z) * alpha + this.offset.z;
  }

  get fixedDt(): number {
    return TICK_DT;
  }
}
