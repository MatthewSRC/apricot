import { describe, expect, it } from "vitest";
import { animationFrameScheduler, FrameLoop, type FrameScheduler } from "../loop";

/** A scheduler the test advances by hand. */
const manualScheduler = () => {
  let next = 1;
  const pending = new Map<number, (t: number) => void>();
  let now = 0;
  const scheduler: FrameScheduler = {
    request: (cb) => {
      pending.set(next, cb);
      return next++;
    },
    cancel: (h) => {
      pending.delete(h);
    },
  };
  const step = (ms = 16) => {
    now += ms;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const cb of callbacks) cb(now);
  };
  return { scheduler, step, pendingCount: () => pending.size };
};

describe("FrameLoop", () => {
  it("renders once on start, then sleeps in demand mode", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => renders++ });
    loop.start();
    s.step();
    s.step();
    expect(renders).toBe(1);
    expect(loop.isAwake).toBe(false);
  });

  it("keeps rendering for `linger` seconds after the last change", () => {
    const s = manualScheduler();
    let renders = 0;
    let idles = 0;
    const loop = new FrameLoop({
      scheduler: s.scheduler,
      render: () => renders++,
      onIdle: () => idles++,
      linger: 0.1,
    });
    loop.start();
    for (let i = 0; i < 20; i++) s.step(16);
    // 1 frame for the start, then frames until 0.1 s have passed: 0.016 · 7 ≥ 0.1.
    expect(renders).toBe(8);
    expect(loop.isAwake).toBe(false);
    expect(idles).toBe(1);
    // A change during the linger extends it; no wake-up gap in between.
    loop.invalidate();
    s.step(16);
    s.step(16);
    loop.invalidate();
    for (let i = 0; i < 20; i++) s.step(16);
    expect(renders).toBe(8 + 2 + 8);
    expect(idles).toBe(2);
  });

  it("wakes on invalidate and coalesces repeated calls", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => renders++ });
    loop.start();
    s.step();
    loop.invalidate();
    loop.invalidate();
    loop.invalidate();
    expect(s.pendingCount()).toBe(1);
    s.step();
    expect(renders).toBe(2);
  });

  it("stays awake while a callback reports it is animating", () => {
    const s = manualScheduler();
    let renders = 0;
    let remaining = 3;
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => renders++ });
    loop.add(() => --remaining > 0);
    loop.start();
    for (let i = 0; i < 10; i++) s.step();
    expect(renders).toBe(3);
    expect(loop.isAwake).toBe(false);
  });

  it("schedules one frame at a time when a callback invalidates while animating", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => renders++ });
    // An animation that also invalidates (as InstancesHandle.set does for each copy).
    loop.add(() => {
      loop.invalidate();
      loop.invalidate();
      return true;
    });
    loop.start();
    for (let i = 0; i < 10; i++) {
      s.step();
      expect(s.pendingCount()).toBe(1);
    }
    expect(renders).toBe(10);
  });

  it("renders every frame in always mode", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ mode: "always", scheduler: s.scheduler, render: () => renders++ });
    loop.start();
    for (let i = 0; i < 5; i++) s.step();
    expect(renders).toBe(5);
    expect(loop.frameNumber).toBe(5);
  });

  it("passes time and a capped delta, and does not count idle time", () => {
    const s = manualScheduler();
    const deltas: number[] = [];
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => {} });
    let frames = 2;
    loop.add(({ delta }) => {
      deltas.push(delta);
      return --frames > 0;
    });
    loop.start();
    s.step(16);
    s.step(16);
    s.step(5000); // asleep: nothing scheduled
    frames = 1;
    loop.invalidate();
    s.step(500);
    expect(deltas[0]).toBe(0);
    expect(deltas[1]).toBeCloseTo(0.016);
    expect(deltas[2]).toBe(0); // first frame after waking
  });

  it("stop cancels the scheduled frame", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ mode: "always", scheduler: s.scheduler, render: () => renders++ });
    loop.start();
    s.step();
    loop.stop();
    s.step();
    expect(renders).toBe(1);
    expect(s.pendingCount()).toBe(0);
  });

  it("removing a callback stops it from running", () => {
    const s = manualScheduler();
    let calls = 0;
    const loop = new FrameLoop({ mode: "always", scheduler: s.scheduler, render: () => {} });
    const remove = loop.add(() => {
      calls++;
    });
    loop.start();
    s.step();
    remove();
    s.step();
    expect(calls).toBe(1);
  });
});

describe("FrameLoop modes and state", () => {
  it("switches to always mode and wakes", () => {
    const s = manualScheduler();
    let renders = 0;
    const loop = new FrameLoop({ scheduler: s.scheduler, render: () => renders++ });
    expect(loop.isRunning).toBe(false);
    loop.start();
    loop.start(); // idempotent
    expect(loop.isRunning).toBe(true);
    s.step();
    loop.setMode("always");
    for (let i = 0; i < 3; i++) s.step();
    expect(renders).toBe(4);
    loop.setMode("demand");
    s.step();
    s.step();
    expect(renders).toBe(5);
  });

  it("ignores a frame that arrives after stop", () => {
    const pending: ((t: number) => void)[] = [];
    let renders = 0;
    const loop = new FrameLoop({
      scheduler: { request: (cb) => pending.push(cb), cancel: () => {} },
      render: () => renders++,
    });
    loop.start();
    loop.stop();
    pending[0]?.(16);
    expect(renders).toBe(0);
  });

  it("uses requestAnimationFrame by default", () => {
    const requested: ((t: number) => void)[] = [];
    const cancelled: number[] = [];
    const g = globalThis as Record<string, unknown>;
    g.requestAnimationFrame = (cb: (t: number) => void) => requested.push(cb);
    g.cancelAnimationFrame = (h: number) => cancelled.push(h);
    try {
      expect(animationFrameScheduler.request(() => {})).toBe(1);
      animationFrameScheduler.cancel(1);
      expect(cancelled).toEqual([1]);
      const loop = new FrameLoop({ render: () => {} });
      loop.start();
      expect(requested).toHaveLength(2);
    } finally {
      delete g.requestAnimationFrame;
      delete g.cancelAnimationFrame;
    }
  });
});
