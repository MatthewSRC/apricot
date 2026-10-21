export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface FrameStatsSummary {
  frames: number;
  fps: number;
  intervalMs: Percentiles;
  renderMs: Percentiles;
  presentMs: Percentiles;
}

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export const percentiles = (values: readonly number[]): Percentiles => {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]),
  };
};

/** A fixed-size buffer of the latest samples, so memory does not grow with uptime. */
class Ring {
  private values: number[] = [];
  constructor(private readonly size: number) {}
  push(v: number) {
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
  }
  all() {
    return this.values;
  }
  last(n: number) {
    return this.values.slice(-n);
  }
  clear() {
    this.values = [];
  }
}

const mean = (a: readonly number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/**
 * Frame timing over the latest `capacity` frames:
 * - interval: time between frame starts, which sets the frame rate
 * - render: CPU time from begin() to beforePresent()
 * - present: time from beforePresent() to end(). context.present() can block
 *   waiting for a free buffer, so a GPU-bound frame shows its wait here.
 */
export class FrameStats {
  private readonly intervals: Ring;
  private readonly render: Ring;
  private readonly present: Ring;
  private readonly starts: Ring;
  private lastStart = 0;
  private frameStart = 0;
  private presentStart = 0;

  constructor(
    capacity = 600,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.intervals = new Ring(capacity);
    this.render = new Ring(capacity);
    this.present = new Ring(capacity);
    // Enough for a full second at 240 Hz, whatever the capacity.
    this.starts = new Ring(Math.max(capacity, 256));
  }

  reset() {
    this.intervals.clear();
    this.render.clear();
    this.present.clear();
    this.starts.clear();
    this.lastStart = 0;
  }

  /** Call when the loop goes to sleep, so the next interval is not counted as a dropped frame. */
  markIdle() {
    this.lastStart = 0;
  }

  begin() {
    const t = this.now();
    if (this.lastStart !== 0) this.intervals.push(t - this.lastStart);
    this.lastStart = t;
    this.frameStart = t;
    this.starts.push(t);
    this.presentStart = 0;
  }

  beforePresent() {
    this.presentStart = this.now();
  }

  end() {
    const t = this.now();
    const split = this.presentStart || t;
    this.render.push(split - this.frameStart);
    this.present.push(t - split);
  }

  /**
   * Numbers for a live HUD. `fps` is the number of frames rendered in the
   * last second (0 while the loop sleeps). Render and present times are
   * averaged over the last `window` frames.
   */
  live(window = 60) {
    const since = this.now() - 1000;
    const recent = this.starts.all().filter((t) => t > since).length;
    return {
      fps: recent,
      renderMs: round(mean(this.render.last(window))),
      presentMs: round(mean(this.present.last(window))),
    };
  }

  summary(): FrameStatsSummary {
    const interval = mean(this.intervals.all());
    return {
      frames: this.render.all().length,
      fps: interval ? round(1000 / interval, 1) : 0,
      intervalMs: percentiles(this.intervals.all()),
      renderMs: percentiles(this.render.all()),
      presentMs: percentiles(this.present.all()),
    };
  }
}
