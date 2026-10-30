// Keyboard + pointer-lock mouse. Produces the raw intents the fixed tick samples.
import { Btn, CAMERA } from '@splat/shared';

export class InputState {
  yaw = 0;
  pitch = -0.15;
  sensitivity: number = CAMERA.sensitivityDefault;
  weaponSlot = 0;
  scoreboard = false;
  private keys = new Set<string>();
  private lmb = false;
  private rmb = false;
  /** Latched taps so a press shorter than one tick is never lost. */
  private tapJump = false;
  private tapDash = false;
  onEscape: () => void = () => {};
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboard = true;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.tapJump = true;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.tapDash = true;
      if (e.code >= 'Digit1' && e.code <= 'Digit4') this.weaponSlot = Number(e.code.slice(5)) - 1;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.scoreboard = false;
      this.keys.delete(e.code);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
      this.scoreboard = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, this.pitch - e.movementY * this.sensitivity));
    });
    addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.weaponSlot = (this.weaponSlot + (e.deltaY > 0 ? 1 : 3)) % 4;
    });
    document.addEventListener('pointerlockchange', () => {
      this.lmb = this.rmb = false;
      this.onLockChange(this.locked);
      if (!this.locked) this.onEscape();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }
  lock(): void {
    this.canvas.requestPointerLock()?.catch?.(() => {});
  }
  unlock(): void {
    document.exitPointerLock();
  }

  get aiming(): boolean {
    return this.rmb;
  }

  moveX(): number {
    return (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
  }
  moveZ(): number {
    return (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
  }
  /** Button mask for this tick. */
  buttons(): number {
    let b = 0;
    if (this.keys.has('Space') || this.tapJump) b |= Btn.Jump;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.tapDash) b |= Btn.Dash;
    if (this.lmb) b |= Btn.Fire;
    if (this.rmb) b |= Btn.Aim;
    this.tapJump = this.tapDash = false;
    return b;
  }
}
