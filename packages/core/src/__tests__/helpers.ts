import type { FrameScheduler } from "../loop";
import type { SceneRenderer } from "../scene";

/** A frame scheduler the test advances by hand. */
export const manualScheduler = () => {
  let next = 1;
  let now = 0;
  const pending = new Map<number, (t: number) => void>();
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

/** Records calls instead of touching a GPU. */
export const fakeRenderer = (init: () => Promise<void> = async () => {}) => {
  const calls: string[] = [];
  const renderer: SceneRenderer & { calls: string[]; clearAlpha?: number } = {
    calls,
    toneMapping: 0 as SceneRenderer["toneMapping"],
    init: async () => {
      calls.push("init");
      await init();
      return renderer as never;
    },
    render: () => {
      calls.push("render");
    },
    setSize: (w: number, h: number) => {
      calls.push(`setSize ${w}x${h}`);
    },
    setPixelRatio: (r: number) => {
      calls.push(`setPixelRatio ${r}`);
    },
    setClearColor: (_c: unknown, a?: number) => {
      renderer.clearAlpha = a;
    },
    setAnimationLoop: async () => {
      calls.push("setAnimationLoop");
    },
    dispose: () => {
      calls.push("dispose");
    },
  } as never;
  return renderer;
};

/** A canvas context like react-native-webgpu's, counting present() calls. */
export const fakeContext = () => {
  const context = { canvas: { width: 0, height: 0 }, presents: 0, present: () => context.presents++ };
  return context;
};
