import { afterEach, describe, expect, it, vi } from "vitest";

const made: FakeRenderer[] = [];
class FakeRenderer {
  calls: string[] = [];
  backend = { get: vi.fn((): { texture?: { destroy: () => void } } => ({})), delete: vi.fn() };
  constructor(readonly params: { canvas: { getContext: () => unknown }; device: unknown }) {
    made.push(this);
  }
  init = vi.fn(async () => this);
  setAnimationLoop() {
    this.calls.push("setAnimationLoop");
  }
  dispose() {
    this.calls.push("dispose");
  }
}
class FakeCanvasTarget {
  colorTexture = { dispose: vi.fn() };
  depthTexture = { dispose: vi.fn() };
  dispose = vi.fn();
  constructor(readonly domElement: { width: number; height: number; getContext: () => unknown }) {}
}
vi.mock("three/webgpu", () => ({ WebGPURenderer: FakeRenderer, CanvasTarget: FakeCanvasTarget }));

const { canvasTargetFor, freeCanvasTarget, sharedRenderer, sharedRendererCount } = await import(
  "../renderer"
);

const ask = (key: string, device: unknown, extra: { check?: () => Promise<boolean> } = {}) => {
  const setup = vi.fn();
  return {
    setup,
    shared: sharedRenderer({
      key,
      device: device as GPUDevice,
      setup,
      check: extra.check ?? (async () => true),
      freeAfter: 1000,
    }),
  };
};

afterEach(() => {
  vi.useRealTimers();
  made.length = 0;
});

describe("sharedRenderer", () => {
  it("gives scenes asking alike one renderer, set up once, freed a while after the last goes", async () => {
    vi.useFakeTimers();
    const device = {};
    const a = ask("0|none|", device);
    const b = ask("0|none|", device);
    const [first, second] = await Promise.all([a.shared, b.shared]);
    expect(first.renderer).toBe(second.renderer);
    expect(made).toHaveLength(1);
    expect(a.setup).toHaveBeenCalledTimes(1);
    expect(b.setup).not.toHaveBeenCalled();
    expect(made[0]?.init).toHaveBeenCalledTimes(1);
    expect(first.textureCompare).toBe(true);
    // Draws into no canvas of its own: each scene has its canvas target.
    expect(made[0]?.params.canvas.getContext()).toBeNull();
    expect(made[0]?.params.device).toBe(device);
    expect(sharedRendererCount()).toBe(1);

    // Another key: another renderer.
    const other = await ask("16|none|", device).shared;
    expect(other.renderer).not.toBe(first.renderer);
    expect(sharedRendererCount()).toBe(2);
    other.release();
    vi.advanceTimersByTime(1000);
    expect(sharedRendererCount()).toBe(1);

    first.release();
    first.release(); // once only
    vi.advanceTimersByTime(5000);
    expect(made[0]?.calls).toEqual([]);
    second.release();
    vi.advanceTimersByTime(999);
    // A scene coming back within the wait keeps it.
    const back = await ask("0|none|", device).shared;
    expect(back.renderer).toBe(first.renderer);
    vi.advanceTimersByTime(5000);
    expect(made[0]?.calls).toEqual([]);
    back.release();
    vi.advanceTimersByTime(1000);
    expect(made[0]?.calls).toEqual(["setAnimationLoop", "dispose"]);
    expect(sharedRendererCount()).toBe(0);
  });

  it("starts afresh on a new device, and after a renderer failed to start", async () => {
    vi.useFakeTimers();
    const old = await ask("k", {}).shared;
    const fresh = await ask("k", {}).shared;
    expect(fresh.renderer).not.toBe(old.renderer);
    // The renderer on the lost device goes with its last scene, and leaves the new one shared.
    old.release();
    vi.advanceTimersByTime(1000);
    expect(sharedRendererCount()).toBe(1);
    fresh.release();
    vi.advanceTimersByTime(1000);

    const failing = ask("bad", {}, { check: async () => Promise.reject(new Error("no GPU")) });
    await expect(failing.shared).rejects.toThrow("no GPU");
    expect(sharedRendererCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(made.at(-1)?.calls).toEqual(["setAnimationLoop", "dispose"]);
  });
});

describe("canvasTargetFor", () => {
  it("draws into the context's canvas, sizing it", () => {
    const context = { canvas: { width: 3, height: 2 } } as unknown as GPUCanvasContext;
    const target = canvasTargetFor(context) as unknown as FakeCanvasTarget;
    const element = target.domElement;
    expect(element.getContext()).toBe(context);
    expect([element.width, element.height]).toEqual([3, 2]);
    element.width = 600;
    element.height = 400;
    expect(context.canvas).toEqual({ width: 600, height: 400 });
  });

  it("frees what the renderer keeps for it", () => {
    const renderer = new FakeRenderer({ canvas: { getContext: () => null }, device: {} });
    const destroy = vi.fn();
    renderer.backend.get.mockReturnValue({ texture: { destroy } });
    const target = new FakeCanvasTarget({ width: 1, height: 1, getContext: () => null });
    freeCanvasTarget(renderer, target as never);
    expect(target.dispose).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(target.colorTexture.dispose).toHaveBeenCalled();
    expect(target.depthTexture.dispose).toHaveBeenCalled();
    expect(renderer.backend.delete.mock.calls.map(([object]) => object)).toEqual([
      target.colorTexture,
      target.depthTexture,
      target,
    ]);
    // A renderer without a backend (a test double): only the target's own dispose.
    freeCanvasTarget({}, target as never);
    expect(target.dispose).toHaveBeenCalledTimes(2);
  });
});
