import { describe, expect, it } from "vitest";
import { FrameStats, percentiles } from "../stats";

describe("percentiles", () => {
  it("handles empty input", () => {
    expect(percentiles([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
  });
  it("picks values by rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(values)).toEqual({ p50: 51, p95: 96, p99: 100, max: 100 });
  });
});

describe("FrameStats", () => {
  it("splits render and present time", () => {
    let t = 0;
    const stats = new FrameStats(100, () => t);
    for (let i = 0; i < 3; i++) {
      stats.begin();
      t += 4; // render
      stats.beforePresent();
      t += 1; // present
      stats.end();
      t += 11.67; // rest of a 60 Hz frame
    }
    const s = stats.summary();
    expect(s.frames).toBe(3);
    expect(s.renderMs.p50).toBe(4);
    expect(s.presentMs.p50).toBe(1);
    expect(s.fps).toBeCloseTo(60, 0);
  });

  it("does not count idle gaps as slow frames", () => {
    let t = 0;
    const stats = new FrameStats(100, () => t);
    stats.begin();
    stats.end();
    t += 5000;
    stats.markIdle();
    stats.begin();
    stats.end();
    expect(stats.summary().intervalMs.max).toBe(0);
  });
});

describe("FrameStats live view and reset", () => {
  it("counts frames rendered in the last second, averages recent times, and clears on reset", () => {
    let t = 0;
    const stats = new FrameStats(3, () => t);
    expect(stats.live()).toEqual({ fps: 0, renderMs: 0, presentMs: 0 });
    expect(stats.summary().fps).toBe(0);
    for (let i = 0; i < 150; i++) {
      stats.begin();
      t += 2;
      stats.end(); // no present split: all render
      t += 6.33;
    }
    const live = stats.live();
    expect(live.fps).toBe(120);
    expect(live.renderMs).toBe(2);
    expect(live.presentMs).toBe(0);
    expect(stats.summary().frames).toBe(3); // ring capacity
    // Asleep for a second: nothing rendered recently.
    t += 1000;
    expect(stats.live().fps).toBe(0);
    stats.reset();
    expect(stats.summary().frames).toBe(0);
  });

  it("defaults to performance.now", () => {
    const stats = new FrameStats();
    stats.begin();
    stats.end();
    expect(stats.summary().frames).toBe(1);
  });
});
