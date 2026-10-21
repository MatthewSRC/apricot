import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canOcclude, SceneOcclusion } from "../occlusion";
import { ApricotScene } from "../scene";
import { fakeContext, fakeRenderer, manualScheduler } from "./helpers";

/** Enough of a WebGPURenderer for the occlusion: its render target and compiling. */
const occludingRenderer = () => {
  const base = fakeRenderer();
  let target: THREE.RenderTarget | null = null;
  const seen: {
    compiling: (THREE.RenderTarget | null)[];
    drawing: (THREE.RenderTarget | null)[];
    args: unknown[][];
  } = { compiling: [], drawing: [], args: [] };
  let finish: () => void = () => {};
  const renderer = Object.assign(base, {
    isWebGPURenderer: true,
    samples: 4,
    transparent: true,
    outputColorSpace: THREE.SRGBColorSpace,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.RenderTarget | null) => {
      target = next;
    },
    getMRT: () => null,
    setMRT: () => {},
    getOutputBufferType: () => THREE.HalfFloatType,
    compileAsync: (...args: unknown[]) => {
      seen.compiling.push(target);
      seen.args.push(args);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  return { renderer, seen, finish: () => finish(), target: () => target };
};

afterEach(() => vi.restoreAllMocks());

describe("SceneOcclusion", () => {
  it("is for three's WebGPU renderer only", () => {
    expect(canOcclude({ isWebGPURenderer: true })).toBe(true);
    expect(canOcclude(fakeRenderer())).toBe(false);
    expect(canOcclude(null)).toBe(false);
  });

  it("compiles each pass into its own target, and draws to the screen meanwhile", async () => {
    const { renderer, seen, finish, target } = occludingRenderer();
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
    scene.add(mesh);
    const occlusion = new SceneOcclusion(renderer as never, scene, new THREE.PerspectiveCamera(), {
      strength: 0.5,
    });
    const drawn = vi.spyOn(THREE.RenderPipeline.prototype, "render").mockImplementation(() => {
      seen.drawing.push(target());
    });

    const compiled = occlusion.compileAsync();
    // The normals pass first: drawn with one plain material, without see-through things.
    expect(seen.compiling).toHaveLength(1);
    expect(seen.compiling[0]).not.toBeNull();
    expect(scene.overrideMaterial).toBeNull();
    expect(renderer.transparent).toBe(true);
    // A frame while it compiles goes to the screen, and the pass's target is put back after.
    occlusion.render();
    expect(seen.drawing).toEqual([null]);
    expect(target()).toBe(seen.compiling[0]);
    finish();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // Then the scene pass, multisampled like the screen.
    expect(seen.compiling).toHaveLength(2);
    expect(seen.compiling[1]?.samples).toBe(4);
    finish();
    await compiled;
    expect(target()).toBeNull();
    occlusion.render();
    expect(drawn).toHaveBeenCalledTimes(2);
    occlusion.dispose();
  });

  it("compiles parts of the scene with its lights", async () => {
    const { renderer, seen, finish } = occludingRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const part = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
    scene.add(part);
    const occlusion = new SceneOcclusion(renderer as never, scene, camera);
    const compiled = occlusion.compileAsync([part]);
    finish();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    finish();
    await compiled;
    expect(seen.args).toEqual([
      [part, camera, scene],
      [part, camera, scene],
    ]);
    occlusion.dispose();
  });

  it("puts things back when compiling fails", async () => {
    const { renderer, target } = occludingRenderer();
    renderer.compileAsync = () => Promise.reject(new Error("no"));
    const occlusion = new SceneOcclusion(renderer as never, new THREE.Scene(), new THREE.PerspectiveCamera());
    await expect(occlusion.compileAsync()).rejects.toThrow("no");
    expect(target()).toBeNull();
  });

  it("is what a scene with `occlusion` draws with, and what it warms up", async () => {
    const s = manualScheduler();
    const { renderer } = occludingRenderer();
    renderer.compileAsync = () => Promise.resolve();
    const scene = new ApricotScene({
      scheduler: s.scheduler,
      createRenderer: () => renderer as never,
      occlusion: { radius: 0.5 },
    });
    const draw = vi.spyOn(SceneOcclusion.prototype, "render").mockImplementation(() => {});
    const compile = vi.spyOn(SceneOcclusion.prototype, "compileAsync");
    await scene.attach(fakeContext() as never, { width: 100, height: 100, devicePixelRatio: 1 });
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial()));
    await scene.warmUp();
    expect(compile).toHaveBeenCalled();
    s.step();
    expect(draw).toHaveBeenCalled();
    expect(renderer.calls).not.toContain("render");
    expect(scene.report().options).toMatchObject({ occlusion: true });
    const dispose = vi.spyOn(SceneOcclusion.prototype, "dispose");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    scene.detach();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(dispose).toHaveBeenCalled();
  });

  it("is skipped with a renderer that cannot do it", async () => {
    const s = manualScheduler();
    const renderer = fakeRenderer();
    const scene = new ApricotScene({
      scheduler: s.scheduler,
      createRenderer: () => renderer,
      occlusion: true,
    });
    await scene.attach(fakeContext() as never, { width: 100, height: 100, devicePixelRatio: 1 });
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    s.step();
    expect(renderer.calls).toContain("render");
    expect(scene.report().options).toMatchObject({ occlusion: false });
  });
});
