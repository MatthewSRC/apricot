import { type Pixels, readTexture, readWebGL } from "../capture";
import { isWebGLContext } from "../renderer";
import type { CanvasContext } from "./types";

/** Promises waiting for a frame that shows everything added to the scene (see ApricotScene.drawn). */
export class DrawnWaiters {
  private framesDrawn = 0;
  private waiting: { after: number; until: number; resolve: () => void }[] = [];

  constructor(private readonly now: () => number) {}

  /**
   * Adds a waiter. It is resolved by a complete frame drawn two frames from
   * now, by which time a React update made now is in the scene, or by any
   * such frame after `timeout` ms.
   */
  add(timeout: number, resolve: () => void) {
    this.waiting.push({ after: this.framesDrawn + 2, until: this.now() + timeout, resolve });
  }

  /**
   * Counts a drawn frame and resolves the waiters it satisfies. `complete`
   * says whether the frame showed everything. Returns true while some still
   * wait, so the caller requests another frame.
   */
  frameDrawn(complete: boolean) {
    this.framesDrawn++;
    if (this.waiting.length === 0) return false;
    const now = this.now();
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) {
      if (this.framesDrawn >= w.after && (complete || now >= w.until)) w.resolve();
      else this.waiting.push(w);
    }
    return this.waiting.length > 0;
  }

  resolveAll() {
    for (const w of this.waiting.splice(0)) w.resolve();
  }
}

/** Promises waiting for the pixels of the next frame (see ApricotScene.capture). */
export class FrameCaptures {
  private waiting: { resolve: (pixels: Pixels) => void; reject: (error: unknown) => void }[] = [];

  get pending() {
    return this.waiting.length > 0;
  }

  /** The pixels of the next frame read with read(). */
  next() {
    return new Promise<Pixels>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  /**
   * Reads the frame just drawn into `context` for every waiter. Runs before
   * the frame is presented, while its texture can still be read.
   */
  read(renderer: unknown, context: CanvasContext | null) {
    const waiting = this.waiting.splice(0);
    const done = (pixels: Pixels) => {
      for (const w of waiting) w.resolve(pixels);
    };
    const failed = (error: unknown) => {
      for (const w of waiting) w.reject(error);
    };
    try {
      if (isWebGLContext(context)) {
        done(readWebGL(context));
        return;
      }
      const device = (renderer as { backend?: { device?: GPUDevice } } | null)?.backend?.device;
      if (!device || !context) throw new Error("[apricot] capture: no GPU device to read the frame from");
      readTexture(device, context.getCurrentTexture()).then(done, failed);
    } catch (error) {
      failed(error);
    }
  }

  /** Rejects every waiter with an error carrying `message`. */
  rejectAll(message: string) {
    for (const w of this.waiting.splice(0)) w.reject(new Error(message));
  }
}
