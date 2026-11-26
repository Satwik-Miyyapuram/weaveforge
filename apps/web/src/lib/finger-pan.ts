/**
 * A one-finger pan that flicks, as OneNote's does: while the finger is down the
 * page follows it, and on release it glides on at the finger's speed, slowing
 * by friction. The glide's length grows with the release speed. A normal pan
 * (slow, or paused before lifting) does not glide at all; only a flick does,
 * as Flutter's and Android's fling detection decide it.
 */

/** The share of glide speed kept per millisecond (a ~330 ms time constant). */
const FRICTION_PER_MS = 0.997;
/** Below this many px per ms the glide is over. */
const STOP_PX_PER_MS = 0.02;
/** A release slower than this (300 px/s) is a pan, not a flick: no glide. */
const MIN_FLING_PX_PER_MS = 0.3;
/** Fling speeds are capped (Flutter's kMaxFlingVelocity, 8000 px/s). */
const MAX_FLING_PX_PER_MS = 8;
/** A finger still this long before lifting has stopped (Flutter and Android use 40 ms). */
const STOPPED_MS = 40;
/** The release speed is the finger's travel over this last stretch of time. */
const VELOCITY_WINDOW_MS = 80;

interface Frames {
  now: () => number;
  request: (run: (time: number) => void) => number;
  cancel: (id: number) => void;
}

const browserFrames: Frames = {
  now: () => performance.now(),
  request: (run) => requestAnimationFrame(run),
  cancel: (id) => cancelAnimationFrame(id),
};

export class FingerPan {
  private samples: { t: number; dx: number; dy: number }[] = [];
  private glide: number | null = null;

  /** `scrollBy` moves the scroller's content; the page goes opposite to it. */
  constructor(
    private readonly scrollBy: (dx: number, dy: number) => void,
    private readonly frames: Frames = browserFrames,
  ) {}

  /** The finger moved by dx, dy client px: the paper follows it. */
  move(dx: number, dy: number): void {
    const t = this.frames.now();
    this.samples.push({ t, dx, dy });
    this.samples = this.samples.filter((s) => t - s.t <= VELOCITY_WINDOW_MS);
    this.scrollBy(-dx, -dy);
  }

  /** The finger lifted: glide on at its speed over the last stretch, if it was still moving. */
  release(): void {
    const now = this.frames.now();
    const recent = this.samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
    this.samples = [];
    if (recent.length < 2 || now - recent[recent.length - 1]!.t > STOPPED_MS) return;
    const span = Math.max(1, now - recent[0]!.t);
    // The first sample's move happened before the window began, so it is not counted.
    let vx = recent.slice(1).reduce((sum, s) => sum + s.dx, 0) / span;
    let vy = recent.slice(1).reduce((sum, s) => sum + s.dy, 0) / span;
    const speed = Math.hypot(vx, vy);
    if (speed < MIN_FLING_PX_PER_MS) return;
    if (speed > MAX_FLING_PX_PER_MS) {
      vx *= MAX_FLING_PX_PER_MS / speed;
      vy *= MAX_FLING_PX_PER_MS / speed;
    }
    let last = now;
    const step = (time: number) => {
      const dt = Math.max(0, time - last);
      last = time;
      const keep = FRICTION_PER_MS ** dt;
      vx *= keep;
      vy *= keep;
      if (Math.hypot(vx, vy) < STOP_PX_PER_MS) {
        this.glide = null;
        return;
      }
      this.scrollBy(-vx * dt, -vy * dt);
      this.glide = this.frames.request(step);
    };
    this.glide = this.frames.request(step);
  }

  /** A finger landed, or the gesture changed: the page stops where it is. */
  stop(): void {
    this.samples = [];
    if (this.glide !== null) this.frames.cancel(this.glide);
    this.glide = null;
  }
}
