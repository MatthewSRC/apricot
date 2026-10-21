/**
 * "demand" (the default) schedules a frame only after invalidate() or while
 * a frame callback reports that it is still animating, so nothing runs while
 * the scene is idle. "always" renders every display frame.
 */
export type FrameLoopMode = "demand" | "always";

export interface FrameState {
  /** Seconds since the loop started. */
  time: number;
  /** Seconds since the previous rendered frame (0 on the first one, capped at 0.1). */
  delta: number;
  /** Rendered frame count. */
  frame: number;
}

/**
 * Runs before each render. Return `true` while still animating to keep the
 * loop awake in "demand" mode; return nothing or `false` when done.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: lets callbacks with no return statement type-check
export type FrameCallback = (state: FrameState) => boolean | undefined | void;

export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface FrameLoopOptions {
  mode?: FrameLoopMode;
  scheduler?: FrameScheduler;
  /** Draws the frame after the callbacks ran. */
  render: (state: FrameState) => void;
  /** Called when the loop goes to sleep (demand mode). */
  onIdle?: () => void;
  /**
   * In demand mode, seconds to keep rendering after the last change (default
   * 0). A burst of changes, such as a drag, then renders as one continuous
   * animation instead of waking the loop for every value.
   */
  linger?: number;
}

/** Runs the frame callbacks and then renders, once per scheduled frame. */
export class FrameLoop {
  private readonly callbacks = new Set<FrameCallback>();
  private readonly scheduler: FrameScheduler;
  private readonly renderFrame: (state: FrameState) => void;
  private readonly onIdle?: () => void;
  private readonly linger: number;
  private lastActive = -1;
  private mode: FrameLoopMode;
  private handle: number | null = null;
  private running = false;
  private invalidated = false;
  private startTime = -1;
  private lastTime = -1;
  private frame = 0;

  constructor(options: FrameLoopOptions) {
    this.mode = options.mode ?? "demand";
    this.scheduler = options.scheduler ?? animationFrameScheduler;
    this.renderFrame = options.render;
    this.onIdle = options.onIdle;
    this.linger = options.linger ?? 0;
  }

  get isRunning() {
    return this.running;
  }

  /** True when a frame is scheduled. */
  get isAwake() {
    return this.handle !== null;
  }

  /**
   * When true, only invalidate() schedules frames. Animating callbacks and
   * "always" mode do not keep the loop going. Used for a paused scene that is
   * getting ready.
   */
  quiet = false;

  setMode(mode: FrameLoopMode) {
    this.mode = mode;
    if (mode === "always") this.invalidate();
  }

  /** Adds a per-frame callback and wakes the loop. Returns the remover. */
  add(callback: FrameCallback): () => void {
    this.callbacks.add(callback);
    this.invalidate();
    return () => {
      this.callbacks.delete(callback);
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.invalidate();
  }

  stop() {
    this.running = false;
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  /** Milliseconds the frame callbacks took in the latest frame. */
  callbacksMs = 0;

  /**
   * The number of frames run so far. It stays the same during one frame's
   * callbacks, so it can key per-frame caches.
   */
  get frameNumber() {
    return this.frame;
  }

  /** Requests a frame. Safe to call many times per frame. */
  invalidate() {
    this.invalidated = true;
    if (this.running && this.handle === null) {
      this.handle = this.scheduler.request(this.tick);
    }
  }

  private readonly tick = (timestampMs: number) => {
    this.handle = null;
    if (!this.running) return;
    const requested = this.invalidated;
    this.invalidated = false;

    const now = timestampMs / 1000;
    if (this.startTime < 0) this.startTime = now;
    const delta = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, 0.1);
    this.lastTime = now;
    const state: FrameState = { time: now - this.startTime, delta, frame: this.frame++ };

    let active = false;
    const started = performance.now();
    for (const callback of this.callbacks) {
      if (callback(state) === true) active = true;
    }
    this.callbacksMs = performance.now() - started;
    this.renderFrame(state);

    if (requested || active) this.lastActive = now;
    const lingering = now - this.lastActive < this.linger;
    const going = this.quiet
      ? this.invalidated
      : this.mode === "always" || active || this.invalidated || lingering;
    if (going) {
      // invalidate() during this frame may already have scheduled the next one. A second request
      // would add a duplicate frame, and the duplicates would multiply.
      if (this.handle === null) this.handle = this.scheduler.request(this.tick);
    } else {
      // The next frame's delta must not include the time asleep.
      this.lastTime = -1;
      this.onIdle?.();
    }
  };
}
