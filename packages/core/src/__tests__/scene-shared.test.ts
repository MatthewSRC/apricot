import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { fakeContext, fakeRenderer, manualScheduler } from "./helpers";

// One renderer for every scene, aimed at each scene's canvas target in turn.
const aim = { target: null as unknown, canvas: null as unknown };
const renderer = Object.assign(fakeRenderer(), {
  toneMappingExposure: 1,
  getRenderTarget: () => aim.target,
  setRenderTarget: (target: unknown) => {
    aim.target = target;
  },
  getCanvasTarget: () => aim.canvas,
  setCanvasTarget: (canvas: unknown) => {
    aim.canvas = canvas;
  },
});
const release = vi.fn();
const sharedRenderer = vi.fn(async (_options: { key: string }) => ({
  renderer,
  textureCompare: true,
  release,
}));
const freeCanvasTarget = vi.fn();
const ownRenderer = fakeRenderer();
const createRenderer = vi.fn((_options: { context: unknown }) => ownRenderer);
vi.mock("../renderer", async (original) => ({
  ...(await original<typeof import("../renderer")>()),
  sharedDevice: async () => ({}),
  createRenderer,
  sharedRenderer,
  freeCanvasTarget,
  canvasTargetFor: (context: { canvas: { width: number; height: number } }) => ({
    context,
    setPixelRatio: () => {},
    setSize: (width: number, height: number) => {
      context.canvas.width = width;
      context.canvas.height = height;
    },
  }),
}));

const { ApricotScene } = await import("../scene");

const size = { width: 300, height: 200, devicePixelRatio: 2 };

describe("scenes on one renderer", () => {
  it("each draws to its own canvas with its own settings, and puts the renderer's aim back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = manualScheduler();
      const day = new ApricotScene({ scheduler: s.scheduler, warmUp: false, look: "flat", exposure: 1.2 });
      const night = new ApricotScene({ scheduler: s.scheduler, warmUp: false, transparent: true });
      const dayContext = fakeContext();
      const nightContext = fakeContext();
      await day.attach(dayContext as never, size);
      await night.attach(nightContext as never, size);
      expect(sharedRenderer).toHaveBeenCalledTimes(2);
      expect(sharedRenderer.mock.calls.map(([options]) => options.key)).toEqual(["0|none|", "0|none|"]);
      expect(dayContext.canvas).toEqual({ width: 600, height: 400 });
      // Sized through its canvas target, not the renderer.
      expect(renderer.calls.filter((call) => call.startsWith("setSize"))).toEqual([]);

      const seen: string[] = [];
      renderer.render = () => {
        const canvas = aim.canvas as { context: unknown };
        seen.push(
          `${canvas.context === dayContext ? "day" : canvas.context === nightContext ? "night" : "elsewhere"} ${renderer.toneMapping} ${renderer.toneMappingExposure} ${renderer.clearAlpha}`,
        );
      };
      // Another scene's warm-up aimed it at a pass of its own, between its steps.
      const pass = {};
      const elsewhere = {};
      aim.target = pass;
      aim.canvas = elsewhere;
      for (const scene of [day, night])
        scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
      s.step();
      expect(seen).toEqual([`day ${THREE.NoToneMapping} 1.2 1`, `night ${THREE.AgXToneMapping} 1 0`]);
      expect(aim).toEqual({ target: pass, canvas: elsewhere });

      // A frame callback that throws: the next frame is still aimed right, and put back after.
      const off = day.loop.add(() => {
        throw new Error("callback");
      });
      day.invalidate();
      expect(() => s.step()).toThrow("callback");
      off();
      // Others drew since.
      aim.target = pass;
      aim.canvas = elsewhere;
      seen.length = 0;
      day.invalidate();
      s.step();
      expect(seen).toEqual([`day ${THREE.NoToneMapping} 1.2 1`]);
      expect(aim).toEqual({ target: pass, canvas: elsewhere });

      day.detach();
      night.detach();
      expect(release).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(freeCanvasTarget).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledTimes(2);
      expect(renderer.calls).not.toContain("dispose");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a scene on a WebGL 2 context", () => {
  it("gets a renderer of its own, sized directly, and is never presented", async () => {
    sharedRenderer.mockClear();
    const s = manualScheduler();
    const scene = new ApricotScene({ scheduler: s.scheduler, warmUp: false });
    const context = { canvas: { width: 0, height: 0 }, getExtension: () => null, present: vi.fn() };
    await scene.attach(context as never, size);
    expect(sharedRenderer).not.toHaveBeenCalled();
    expect(createRenderer.mock.calls.at(-1)?.[0].context).toBe(context);
    expect(context.canvas).toEqual({ width: 600, height: 400 });
    expect(ownRenderer.calls.filter((call) => call.startsWith("setSize"))).toHaveLength(1);
    expect(
      scene
        .report()
        .events.filter((e) => e.kind === "attached")
        .at(-1)?.detail,
    ).toMatchObject({
      backend: "webgl",
      sharedRenderer: false,
    });
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    s.step();
    expect(context.present).not.toHaveBeenCalled();
    scene.detach();
  });
});
