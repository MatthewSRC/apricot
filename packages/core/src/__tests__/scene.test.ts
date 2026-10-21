import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skipsBundles } from "../bundle";
import { ApricotScene, compileWhileHidden, sceneRegistry } from "../scene";
import { fakeContext, fakeRenderer, manualScheduler } from "./helpers";

// Every scene made, detached after each test. A scene left showing would make the next one warm up
// in short slices.
const made: ApricotScene[] = [];
afterEach(() => {
  for (const scene of made.splice(0)) scene.detach();
});

const setup = (options: ConstructorParameters<typeof ApricotScene>[0] = {}) => {
  const s = manualScheduler();
  const renderer = fakeRenderer();
  const scene = new ApricotScene({ scheduler: s.scheduler, createRenderer: () => renderer, ...options });
  made.push(scene);
  return { s, renderer, scene, context: fakeContext() };
};

const size = { width: 300, height: 200, devicePixelRatio: 3 };

describe("ApricotScene", () => {
  it("applies the soft look by default and positions the camera", () => {
    const scene = new ApricotScene({
      camera: { position: [0, 2, 5], target: [0, 1, 0], fov: 40, far: 3000 },
    });
    expect(scene.camera.far).toBe(3000);
    expect(scene.scene.getObjectByName("apricot:look")).toBeDefined();
    expect(scene.camera.position.toArray()).toEqual([0, 2, 5]);
    expect(scene.camera.fov).toBe(40);
    const forward = new THREE.Vector3();
    scene.camera.getWorldDirection(forward);
    expect(forward.y).toBeLessThan(0); // looking down at the target
  });

  it("supports no look, a custom background and transparency", () => {
    expect(new ApricotScene({ look: "none" }).scene.getObjectByName("apricot:look")).toBeUndefined();
    const custom = new ApricotScene({ background: "#123456" });
    expect((custom.scene.background as THREE.Color).getHexString()).toBe("123456");
    expect(new ApricotScene({ transparent: true }).scene.background).toBeNull();
  });

  it("draws the background and fog so they show as the colours asked for, after tone mapping", async () => {
    const { s, renderer, scene, context } = setup({ background: "#ffffff", fog: true, warmUp: false });
    const drawn: string[] = [];
    renderer.render = (root: THREE.Object3D) => {
      const r = root as THREE.Scene;
      drawn.push(
        `${(r.background as THREE.Color).r.toFixed(1)} ${(r.fog as THREE.Fog | null)?.color.r.toFixed(1)}`,
      );
    };
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    s.step();
    // AgX shows 1.0 as light grey: white is drawn far brighter, and put back after.
    expect(drawn.at(-1)).toMatch(/^1[0-9]\.\d [1-9][0-9]\.\d$/);
    expect((scene.scene.background as THREE.Color).getHexString()).toBe("ffffff");
    expect((scene.scene.fog as THREE.Fog).color.getHexString()).toBe("ffffff");
    // Without tone mapping: as is.
    renderer.toneMapping = THREE.NoToneMapping;
    scene.invalidate();
    s.step();
    expect(drawn.at(-1)).toBe("1.0 1.0");
  });

  it("adds fog in the background colour, or as configured", () => {
    const soft = new ApricotScene({ fog: true });
    const fog = soft.scene.fog as THREE.Fog;
    expect(fog.color.equals(soft.scene.background as THREE.Color)).toBe(true);
    expect([fog.near, fog.far]).toEqual([30, 90]);
    const custom = new ApricotScene({ fog: { near: 5, far: 10, color: "#ff0000" } }).scene.fog as THREE.Fog;
    expect([custom.near, custom.far, custom.color.getHexString()]).toEqual([5, 10, "ff0000"]);
    const plain = new ApricotScene({ look: "none", fog: { far: 50 } }).scene.fog as THREE.Fog;
    expect(plain.color.getHexString()).toBe("ffffff");
    expect(new ApricotScene().scene.fog).toBeNull();
  });

  it("sizes the canvas with a capped pixel ratio and starts rendering", async () => {
    const { s, renderer, scene, context } = setup();
    await scene.attach(context as never, size);
    expect(context.canvas).toEqual({ width: 600, height: 400 });
    expect(renderer.calls.slice(0, 3)).toEqual(["setPixelRatio 1", "setSize 600x400", "init"]);
    expect(scene.camera.aspect).toBeCloseTo(1.5);
    expect(scene.isAttached).toBe(true);
    expect(scene.threeRenderer).toBe(renderer);
    s.step();
    expect(renderer.calls).toContain("render");
    expect(context.presents).toBe(1);
    expect(scene.stats.summary().frames).toBe(1);
  });

  it("uses the look's tone mapping and clears transparent scenes to alpha 0", async () => {
    const flat = setup({ look: "flat" });
    await flat.scene.attach(flat.context as never, size);
    expect(flat.renderer.toneMapping).toBe(THREE.NoToneMapping);
    const none = setup({ look: "none", transparent: true });
    await none.scene.attach(none.context as never, size);
    expect(none.renderer.toneMapping).toBe(THREE.AgXToneMapping);
    expect(none.renderer.clearAlpha).toBe(0);
  });

  it("follows resizes and tells listeners, ignoring no-ops and empty sizes", async () => {
    const { s, renderer, scene, context } = setup();
    const sizes: { width: number; height: number }[] = [];
    const off = scene.onResize((next) => sizes.push({ width: next.width, height: next.height }));
    scene.resize({ width: 100, height: 100, devicePixelRatio: 1 }); // not attached yet
    await scene.attach(context as never, size);
    expect(scene.size).toEqual(size);
    s.step();
    scene.resize(size);
    scene.resize({ width: 0, height: 10, devicePixelRatio: 2 });
    expect(sizes).toEqual([]);
    scene.resize({ width: 200, height: 300, devicePixelRatio: 2 });
    expect(context.canvas).toEqual({ width: 400, height: 600 });
    expect(renderer.calls).toContain("setSize 400x600");
    expect(scene.camera.aspect).toBeCloseTo(2 / 3);
    expect(sizes).toEqual([{ width: 200, height: 300 }]);
    expect(scene.loop.isAwake).toBe(true);
    off();
    scene.resize({ width: 210, height: 300, devicePixelRatio: 2 });
    expect(sizes).toHaveLength(1);
  });

  it("refuses a second attach", async () => {
    const { scene, context } = setup();
    await scene.attach(context as never, size);
    await expect(scene.attach(context as never, size)).rejects.toThrow(/already attached/);
  });

  it("detach stops drawing at once, and frees the renderer a second later (past a screen's transition)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { s, renderer, scene, context } = setup();
    await scene.attach(context as never, size);
    scene.detach();
    expect(scene.isAttached).toBe(false);
    s.step();
    expect(renderer.calls).not.toContain("render");
    expect(renderer.calls).not.toContain("dispose");
    vi.advanceTimersByTime(1000);
    expect(renderer.calls).toContain("dispose");
    vi.useRealTimers();
  });

  it("warms up in short slices while another scene shows, not to stall it", async () => {
    const g = globalThis as { self?: object };
    const hadSelf = "self" in g;
    if (!hadSelf) g.self = {};
    const started = (scene: ApricotScene) =>
      scene
        .report()
        .events.filter((e) => e.kind === "warm-up started")
        .at(-1)?.detail;
    const shown = setup();
    Object.assign(shown.renderer, { compileAsync: () => Promise.resolve() });
    await shown.scene.attach(shown.context as never, size);
    await shown.scene.warmUp();
    // Alone, before its first frame: long slices.
    expect(started(shown.scene)).toMatchObject({ slice: 50 });
    shown.scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    shown.scene.invalidate();
    shown.s.step();
    expect(shown.scene.ready).toBe(true);
    const next = setup();
    Object.assign(next.renderer, { compileAsync: () => Promise.resolve() });
    await next.scene.attach(next.context as never, size);
    await next.scene.warmUp();
    expect(started(next.scene)).toMatchObject({ slice: 8 });
    // The other one paused (out of sight): long again.
    shown.scene.pause();
    await next.scene.warmUp();
    expect(started(next.scene)).toMatchObject({ slice: 50 });
    shown.scene.detach();
    next.scene.detach();
    if (!hadSelf) delete g.self;
  });

  it("takes turns warming up with other scenes, those drawn first", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const compiling: string[] = [];
    const finish: (() => void)[] = [];
    const make = async (name: string, paused = false) => {
      const made = setup();
      Object.assign(made.renderer, {
        compileAsync: () =>
          new Promise<void>((resolve) => {
            compiling.push(name);
            finish.push(resolve);
          }),
      });
      if (paused) made.scene.pause();
      await made.scene.attach(made.context as never, size);
      return made.scene;
    };
    await make("first");
    const hidden = await make("hidden", true);
    await make("shown");
    await vi.advanceTimersByTimeAsync(60);
    // One at a time: the others wait, still pending (their first frames keep waiting too).
    expect(compiling).toEqual(["first"]);
    expect(hidden.report().events.map((e) => e.kind)).toContain("warm-up waits for another scene");
    // Next the one drawn, though the paused one asked before it.
    finish.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(compiling).toEqual(["first", "shown"]);
    finish.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(compiling).toEqual(["first", "shown", "hidden"]);
    // A scene that goes hands its turn on.
    await make("last");
    await vi.advanceTimersByTimeAsync(60);
    hidden.detach();
    await vi.advanceTimersByTimeAsync(0);
    expect(compiling.at(-1)).toBe("last");
    for (const f of finish.splice(0)) f();
    vi.useRealTimers();
  });

  it("never keeps a drawn scene waiting for a paused one, and a paused one waits for drawn ones", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const compiling: string[] = [];
    const make = async (name: string, paused: boolean) => {
      const made = setup();
      Object.assign(made.renderer, {
        compileAsync: () => {
          compiling.push(name);
          return new Promise<void>(() => {});
        },
      });
      if (paused) made.scene.pause();
      await made.scene.attach(made.context as never, size);
      return made.scene;
    };
    const hidden = await make("hidden", true);
    const drawn = await make("drawn", false);
    // Both asked together: the drawn one first, the paused one after it.
    await vi.advanceTimersByTimeAsync(60);
    expect(compiling).toEqual(["drawn"]);
    hidden.detach();
    drawn.detach();
    // The paused one alone compiles; one drawn later starts beside it.
    compiling.length = 0;
    await make("alone", true);
    await vi.advanceTimersByTimeAsync(60);
    await make("later", false);
    await vi.advanceTimersByTimeAsync(60);
    expect(compiling).toEqual(["alone", "later"]);
    vi.useRealTimers();
  });

  it("gets ready unseen while paused before its first frame: frame callbacks run, nothing is drawn", async () => {
    const { s, renderer, scene, context } = setup();
    scene.pause();
    await scene.attach(context as never, size);
    let runs = 0;
    // Always animating (waves): it doesn't keep a paused scene's frames going.
    scene.onFrame(() => {
      runs++;
      return true;
    });
    s.step();
    s.step();
    expect(runs).toBe(1);
    scene.invalidate();
    s.step();
    expect([runs, renderer.calls.filter((c) => c === "render").length]).toEqual([2, 0]);
    expect(scene.ready).toBe(false);
  });

  it("sets one timer for a burst of warm-up requests, and says nothing when its scene leaves mid-way", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { scene, renderer, context } = setup();
    let fail: (error: Error) => void = () => {};
    const compileAsync = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    Object.assign(renderer, { compileAsync });
    await scene.attach(context as never, size);
    const timers = vi.spyOn(globalThis, "setTimeout");
    // A page of shapes coming in, each asking, in one go (the clock still).
    const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now());
    for (let i = 0; i < 100; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry());
      scene.scene.add(mesh);
      scene.requestWarmUp(mesh);
    }
    expect(timers.mock.calls.length).toBeLessThanOrEqual(1);
    timers.mockRestore();
    clock.mockRestore();
    await vi.advanceTimersByTimeAsync(60);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    scene.detach();
    fail(new Error("THREE.WebGPUTextureUtils: Texture already initialized."));
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).not.toHaveBeenCalled();
    expect(scene.report().events.at(-1)).toMatchObject({ kind: "warm-up stopped" });
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("warms up just what arrives while its first frames wait, after the whole scene", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { scene, renderer, context } = setup();
    const compiled: THREE.Object3D[] = [];
    let release: () => void = () => {};
    Object.assign(renderer, {
      compileAsync: (root: THREE.Object3D) =>
        new Promise<void>((resolve) => {
          compiled.push(root);
          release = resolve;
        }),
    });
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.requestWarmUp();
    vi.advanceTimersByTime(60);
    // A model loads meanwhile: just it, after.
    const model = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.scene.add(model);
    scene.requestWarmUp(model, { added: true });
    release();
    await vi.runAllTimersAsync();
    expect(compiled).toEqual([scene.scene, model]);
    expect(scene.ready).toBe(false);
    release();
    await vi.runAllTimersAsync();
  });

  it("stops drawing while paused and starts again, warming up meanwhile", async () => {
    const { s, renderer, scene, context } = setup();
    scene.pause();
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.invalidate();
    s.step();
    expect([scene.isPaused, renderer.calls.filter((c) => c === "render").length]).toEqual([true, 0]);
    scene.pause(false);
    s.step();
    expect(renderer.calls).toContain("render");
    const drawn = renderer.calls.length;
    scene.pause(true);
    scene.invalidate();
    s.step();
    expect(renderer.calls.length).toBe(drawn);
    scene.detach();
  });

  it("disposes a renderer whose init finishes after detach", async () => {
    let finishInit: () => void = () => {};
    const s = manualScheduler();
    const renderer = fakeRenderer(() => new Promise<void>((resolve) => (finishInit = resolve)));
    const scene = new ApricotScene({ scheduler: s.scheduler, createRenderer: () => renderer });
    const attaching = scene.attach(fakeContext() as never, size);
    scene.detach();
    finishInit();
    await attaching;
    expect(renderer.calls).toContain("dispose");
    expect(scene.isAttached).toBe(false);
    expect(s.pendingCount()).toBe(0);
  });

  it("runs frame callbacks and wakes on invalidate", async () => {
    const { s, renderer, scene, context } = setup();
    await scene.attach(context as never, size);
    s.step();
    const frames: number[] = [];
    const remove = scene.onFrame(({ frame }) => {
      frames.push(frame);
    });
    s.step();
    scene.invalidate();
    s.step();
    remove();
    expect(frames).toEqual([1, 2]);
    expect(renderer.calls.filter((c) => c === "render")).toHaveLength(3);
  });

  it("does nothing on a frame without a renderer", () => {
    const { s, scene } = setup();
    scene.loop.start();
    s.step();
    expect(scene.stats.summary().frames).toBe(0);
  });

  it("works without present() (web)", async () => {
    const { s, scene } = setup();
    await scene.attach({ canvas: { width: 0, height: 0 } } as never, size);
    s.step();
    expect(scene.stats.summary().frames).toBe(1);
  });
});

describe("ApricotScene.press", () => {
  it("routes taps in view points to the object under them", async () => {
    const { scene, context } = setup({ camera: { position: [0, 0, 10] } });
    await scene.attach(context as never, size);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    scene.scene.add(box);
    const hits: THREE.Object3D[] = [];
    scene.presses.add(box, (hit) => hits.push(hit.mesh));
    expect(scene.press(150, 100)?.mesh).toBe(box);
    expect(scene.press(5, 5)).toBeNull();
    expect(hits).toEqual([box]);
  });
});

describe("ApricotScene.warmUp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A scene whose renderer records what compileAsync was asked to see. */
  const warmable = async (options: ConstructorParameters<typeof ApricotScene>[0] = {}) => {
    const { scene, renderer, context } = setup(options);
    const seen: boolean[][] = [];
    // Every compile going on (a warm-up of parts compiles each).
    const pending: (() => void)[] = [];
    const compileAsync = vi.fn((root: THREE.Object3D) => {
      const flags: boolean[] = [];
      root.traverse((o) => flags.push(o.frustumCulled));
      seen.push(flags);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    });
    Object.assign(renderer, { compileAsync });
    await scene.attach(context as never, size);
    const release = () => {
      for (const resolve of pending.splice(0)) resolve();
    };
    return { scene, compileAsync, seen, release };
  };

  it("compiles everything, also what the camera cannot see, then restores culling", async () => {
    const { scene, compileAsync, seen, release } = await warmable();
    const far = new THREE.Mesh(new THREE.BoxGeometry());
    far.position.set(0, 0, 500);
    scene.scene.add(far);
    const warming = scene.warmUp();
    expect(compileAsync).toHaveBeenCalledTimes(1);
    expect(seen[0].every((culled) => culled === false)).toBe(true);
    // Culling stays off until compiling ends, since with occlusion the second pass collects objects
    // later. The camera sees into bundles because three compiles only objects outside them.
    expect(far.frustumCulled).toBe(false);
    expect(skipsBundles(scene.camera)).toBe(true);
    // A second request while compiling runs once more afterwards.
    const again = scene.warmUp();
    release();
    await warming;
    expect(far.frustumCulled).toBe(true);
    expect(skipsBundles(scene.camera)).toBe(false);
    release();
    await again;
  });

  it("compiles many things that came at once as the scene, once (a layout's pieces)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { scene, compileAsync, release } = await warmable();
    // The first, whole one.
    vi.advanceTimersByTime(60);
    release();
    await vi.runAllTimersAsync();
    compileAsync.mockClear();
    const add = (n: number) =>
      Array.from({ length: n }, () => {
        const piece = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry()));
        scene.scene.add(piece);
        scene.requestWarmUp(piece, { added: true });
        return piece;
      });
    // A few: each on its own, with the scene's lights.
    const few = add(3);
    vi.advanceTimersByTime(10);
    expect(compileAsync.mock.calls.map(([root]) => root)).toEqual(few);
    release();
    await vi.runAllTimersAsync();
    compileAsync.mockClear();
    // Many: the scene once, not each looking through it for its lights.
    add(40);
    vi.advanceTimersByTime(10);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    expect(compileAsync.mock.calls[0]?.[0]).toBe(scene.scene);
    const note = (scene.report() as { events: { kind: string; detail?: unknown }[] }).events
      .filter((e) => e.kind === "warm-up started")
      .at(-1);
    expect(note?.detail).toMatchObject({ objects: 40 + 3, andMore: 35, together: true });
    release();
    await vi.runAllTimersAsync();
  });

  it("is requested after changes, debounced, and can be turned off", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { scene, compileAsync, release } = await warmable();
    // attach() already asked for one.
    scene.requestWarmUp();
    scene.requestWarmUp();
    vi.advanceTimersByTime(150);
    expect(compileAsync).toHaveBeenCalledTimes(1);
    release();
    const off = await warmable({ warmUp: false });
    off.scene.requestWarmUp();
    vi.advanceTimersByTime(150);
    expect(off.compileAsync).not.toHaveBeenCalled();
    // Detaching cancels a pending one.
    scene.requestWarmUp();
    scene.detach();
    vi.advanceTimersByTime(150);
    expect(compileAsync).toHaveBeenCalledTimes(1);
  });

  it("holds the first frames with content until the warm-up is done, showing the background", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // React Native has `self` (the global) and no scheduler.yield: the warm-up pauses less often.
    const g = globalThis as { self?: object };
    const hadSelf = "self" in g;
    if (!hadSelf) g.self = {};
    const { scene, renderer, s, context } = setup({ background: "#123456" });
    let release: () => void = () => {};
    const compileAsync = vi.fn(
      (..._args: unknown[]) =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    Object.assign(renderer, { compileAsync });
    const drawn: THREE.Object3D[] = [];
    const render = renderer.render.bind(renderer);
    renderer.render = ((root: THREE.Object3D, camera: THREE.Camera) => {
      drawn.push(root);
      return render(root, camera);
    }) as typeof renderer.render;
    await scene.attach(context as never, size);
    const onReady = vi.fn();
    scene.onReady(onReady);
    const unsubscribed = vi.fn();
    scene.onReady(unsubscribed)();
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.requestWarmUp();
    scene.invalidate();
    s.step();
    expect(scene.ready).toBe(false);
    // Held: an empty scene with the background, not the scene.
    expect(drawn.at(-1)).not.toBe(scene.scene);
    expect((drawn.at(-1) as THREE.Scene).background).toBe(scene.scene.background);
    vi.advanceTimersByTime(60);
    // Compiled without a progress callback (three's progress needs ProgressEvent, missing on Hermes).
    expect(compileAsync.mock.calls[0]).toHaveLength(2);
    s.step();
    expect(drawn.at(-1)).not.toBe(scene.scene);
    release();
    await vi.runAllTimersAsync();
    s.step();
    expect(drawn.at(-1)).toBe(scene.scene);
    expect(scene.ready).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(unsubscribed).not.toHaveBeenCalled();
    const late = vi.fn();
    scene.onReady(late)();
    expect(late).toHaveBeenCalledTimes(1);
    const done = scene.report().events.find((e) => e.kind === "warm-up done");
    expect(done?.detail).toMatchObject({ objects: 1, quick: true });
    if (!hadSelf) delete g.self;
    const events = scene.report().events.map((e) => e.kind);
    expect(events).toContain("first frames held for the warm-up");
    expect(events).toContain("first frame");
    // Later, the whole scene's (a new environment) holds no frames.
    const frames = drawn.length;
    scene.requestWarmUp();
    scene.invalidate();
    s.step();
    expect(drawn.length).toBe(frames + 1);
    vi.advanceTimersByTime(60);
    release();
    await vi.runAllTimersAsync();
    // A change to something in view compiles just it, with the scene's lights; meanwhile the last
    // frame stays on screen, drawing and presenting nothing.
    const part = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(part);
    scene.requestWarmUp(part);
    const presents = context.presents;
    scene.invalidate();
    s.step();
    expect([drawn.length, context.presents]).toEqual([frames + 1, presents]);
    vi.advanceTimersByTime(0);
    expect(compileAsync.mock.calls.at(-1)).toEqual([part, scene.camera, scene.scene]);
    s.step();
    expect(drawn.length).toBe(frames + 1);
    release();
    await vi.runAllTimersAsync();
    s.step();
    expect(drawn.length).toBe(frames + 2);
    expect(drawn.at(-1)).toBe(scene.scene);
    expect(scene.report().events.at(-2)).toMatchObject({
      kind: "warm-up started",
      detail: { objects: 1, of: ["Mesh"] },
    });
  });

  it("says when a frame shows what was just added (drawn), and at once once it has left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene, renderer, s, context } = setup();
    const releases: (() => void)[] = [];
    Object.assign(renderer, { compileAsync: () => new Promise<void>((resolve) => releases.push(resolve)) });
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    vi.advanceTimersByTime(60);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    scene.invalidate();
    s.step();
    expect(scene.ready).toBe(true);
    // A new piece, left out of frames while its shaders compile.
    const piece = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(piece);
    scene.requestWarmUp(piece, { added: true });
    let drawn = false;
    void scene.drawn().then(() => {
      drawn = true;
    });
    for (let i = 0; i < 4; i++) s.step();
    await Promise.resolve();
    expect(drawn).toBe(false);
    // Compiled: the next frame has it.
    vi.advanceTimersByTime(0);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    s.step();
    await Promise.resolve();
    expect(drawn).toBe(true);
    // Never more than `timeout`.
    const late = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(late);
    scene.requestWarmUp(late, { added: true });
    let given = false;
    void scene.drawn({ timeout: 100 }).then(() => {
      given = true;
    });
    s.step();
    s.step();
    now += 150;
    s.step();
    await Promise.resolve();
    expect(given).toBe(true);
    // Gone: nothing to wait for.
    scene.detach();
    await expect(scene.drawn()).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("leaves new things out of frames until compiled, and holds frames for changes briefly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene, renderer, s, context } = setup();
    const releases: (() => void)[] = [];
    const compileAsync = vi.fn(
      (..._args: unknown[]) => new Promise<void>((resolve) => releases.push(resolve)),
    );
    Object.assign(renderer, { compileAsync });
    const shown: boolean[] = [];
    const added = new THREE.Mesh(new THREE.BoxGeometry());
    const group = new THREE.Group();
    const render = renderer.render.bind(renderer);
    renderer.render = ((root: THREE.Object3D, camera: THREE.Camera) => {
      shown.push(group.visible);
      return render(root, camera);
    }) as typeof renderer.render;
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    vi.advanceTimersByTime(60);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    scene.invalidate();
    s.step();
    expect(scene.ready).toBe(true);

    // New (in a group of its own): frames go on without it until its shaders are ready.
    group.add(added);
    // A part asking before it is in the scene (a shape's own request) is new too, not a change.
    scene.requestWarmUp(added);
    scene.scene.add(group);
    scene.requestWarmUp(group, { added: true });
    const frames = shown.length;
    scene.invalidate();
    s.step();
    vi.advanceTimersByTime(0);
    // Just the group (what is in it with it), shown while compiling.
    expect(compileAsync.mock.calls.at(-1)?.[0]).toBe(group);
    scene.invalidate();
    s.step();
    expect(shown.slice(frames)).toEqual([false, false]);
    expect(group.visible).toBe(true);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    s.step();
    expect(shown.at(-1)).toBe(true);
    // One that takes too long shows anyway after 1.5 s.
    const late = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(late);
    scene.requestWarmUp(late, { added: true });
    vi.advanceTimersByTime(0);
    const visible: boolean[] = [];
    renderer.render = ((root: THREE.Object3D, camera: THREE.Camera) => {
      visible.push(late.visible);
      return render(root, camera);
    }) as typeof renderer.render;
    scene.invalidate();
    s.step();
    now += 1600;
    scene.invalidate();
    s.step();
    expect(visible).toEqual([false, true]);
    releases.shift()?.();
    await vi.runAllTimersAsync();

    // A change that takes too long holds frames for a third of a second at most.
    const drawn = shown.length + visible.length;
    const count = () => shown.length + visible.length;
    scene.requestWarmUp(late);
    vi.advanceTimersByTime(0);
    scene.invalidate();
    s.step();
    expect(count()).toBe(drawn);
    now += 400;
    scene.invalidate();
    s.step();
    expect(count()).toBe(drawn + 1);
    vi.restoreAllMocks();
  });

  it("holds the next thing back until let go, and says when its shaders are compiled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene, renderer, s, context } = setup();
    const releases: (() => void)[] = [];
    const compileAsync = vi.fn(
      (..._args: unknown[]) => new Promise<void>((resolve) => releases.push(resolve)),
    );
    Object.assign(renderer, { compileAsync });
    await scene.attach(context as never, size);
    const previous = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(previous);
    vi.advanceTimersByTime(60);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    scene.invalidate();
    s.step();

    // The next piece, held while it compiles; the last stays.
    const next = new THREE.Mesh(new THREE.BoxGeometry());
    const seen: string[] = [];
    const render = renderer.render.bind(renderer);
    renderer.render = ((root: THREE.Object3D, camera: THREE.Camera) => {
      seen.push(
        `${previous.parent ? (previous.visible ? "previous" : "-") : ""}|${next.visible ? "next" : "-"}`,
      );
      return render(root, camera);
    }) as typeof renderer.render;
    const show = scene.holdBack(next);
    scene.scene.add(next);
    let compiled = false;
    void scene.compiled(next).then(() => {
      compiled = true;
    });
    vi.advanceTimersByTime(0);
    expect(compileAsync.mock.calls.at(-1)?.[0]).toBe(next);
    scene.invalidate();
    s.step();
    // Longer than new things are kept back: still out.
    now += 2000;
    scene.invalidate();
    s.step();
    expect(seen).toEqual(["previous|-", "previous|-"]);
    expect(next.visible).toBe(true);
    // Drawn by drawn()'s count: a frame with it held is complete.
    const drawn = scene.drawn();
    scene.invalidate();
    s.step();
    s.step();
    await drawn;
    expect(compiled).toBe(false);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    expect(compiled).toBe(true);
    // Swapped in one go.
    previous.removeFromParent();
    show();
    show(); // once only
    seen.length = 0;
    s.step();
    expect(seen).toEqual(["|next"]);

    // Asked after its warm-up: another (quick) one; and without warm-ups, at once.
    let again = false;
    void scene.compiled(next).then(() => {
      again = true;
    });
    vi.advanceTimersByTime(0);
    // On screen already: it stays while that runs (the last frame held a moment, as for any change).
    seen.length = 0;
    scene.invalidate();
    s.step();
    now += 400;
    scene.invalidate();
    s.step();
    expect(seen).toEqual(["|next"]);
    releases.shift()?.();
    await vi.runAllTimersAsync();
    expect(again).toBe(true);
    // A warm-up that never ends: given up after `timeout`.
    let late = false;
    void scene.compiled(next, { timeout: 500 }).then(() => {
      late = true;
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(late).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(late).toBe(true);
    // Scenes going: at once.
    let gone = false;
    void scene.compiled(new THREE.Mesh()).then(() => {
      gone = true;
    });
    scene.detach();
    await Promise.resolve();
    expect(gone).toBe(true);
    const plain = new ApricotScene({ warmUp: false });
    await expect(plain.compiled(next)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });

  it("stops holding after 12 seconds, and draws empty scenes without holding", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene, renderer, s, context } = setup();
    Object.assign(renderer, { compileAsync: () => new Promise<void>(() => {}) });
    const drawn: THREE.Object3D[] = [];
    const render = renderer.render.bind(renderer);
    renderer.render = ((root: THREE.Object3D, camera: THREE.Camera) => {
      drawn.push(root);
      return render(root, camera);
    }) as typeof renderer.render;
    await scene.attach(context as never, size);
    // Nothing to compile yet: the (empty) scene is drawn once the warm-up request is gone.
    vi.advanceTimersByTime(60);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.requestWarmUp();
    scene.invalidate();
    s.step();
    expect(drawn.at(-1)).not.toBe(scene.scene);
    now += 4500;
    scene.invalidate();
    s.step();
    expect(drawn.at(-1)).not.toBe(scene.scene);
    now += 8000;
    scene.invalidate();
    s.step();
    expect(drawn.at(-1)).toBe(scene.scene);
    vi.restoreAllMocks();
  });

  it("compiles what is hidden until needed (particles between bursts), then hides it again", async () => {
    const { scene, compileAsync, release } = await warmable();
    const sparks = new THREE.Mesh(new THREE.BoxGeometry());
    sparks.visible = false;
    compileWhileHidden(sparks);
    const other = new THREE.Mesh(new THREE.BoxGeometry());
    other.visible = false;
    scene.scene.add(sparks, other);
    const visibleWhileCompiling: boolean[] = [];
    compileAsync.mockImplementationOnce(() => {
      visibleWhileCompiling.push(sparks.visible, other.visible);
      return Promise.resolve();
    });
    await scene.warmUp();
    expect(visibleWhileCompiling).toEqual([true, false]);
    expect(sparks.visible).toBe(false);
    release();
  });

  it("reports a failed warm-up without breaking the scene, and does nothing without compileAsync", async () => {
    const { scene, renderer, context } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.assign(renderer, { compileAsync: () => Promise.reject(new Error("lost")) });
    await expect(scene.warmUp()).resolves.toBeUndefined(); // not attached yet: nothing to compile with
    await scene.attach(context as never, size);
    await scene.warmUp();
    expect(warn).toHaveBeenCalledWith("[apricot] Shader warm-up failed:", expect.any(Error));
    const plain = setup();
    await plain.scene.attach(plain.context as never, size);
    await expect(plain.scene.warmUp()).resolves.toBeUndefined();
    // After detach, a queued warm-up never runs, so its warning cannot arrive after the file ends.
    scene.detach();
    plain.scene.detach();
    warn.mockRestore();
  });
});

describe("ApricotScene.report", () => {
  it("records frames and events and reports them with the scene's contents", async () => {
    const { s, scene, context } = setup({ environment: "studio" });
    await scene.attach(context as never, size);
    scene.scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
    scene.invalidate();
    s.step();
    s.step();
    const report = scene.report({ app: "playground" });
    expect(report.app).toBe("playground");
    expect(report.summary.frames).toBeGreaterThanOrEqual(1);
    expect(report.events[0].kind).toBe("attached");
    expect(report.scene.meshes).toBe(1);
    expect(report.options.environment).toBe("studio");
    expect(report.gpu).toBeNull();
    expect(setup({ environment: { intensity: 2 } }).scene.report().options.environment).toBe("custom");
    expect(setup().scene.report().options.environment).toBe("none");
  });
});

describe("sceneRegistry", () => {
  it("is a shared registry of ApricotScenes", () => {
    const { id, scene } = sceneRegistry.acquire(undefined, () => new ApricotScene({ look: "none" }));
    expect(scene).toBeInstanceOf(ApricotScene);
    sceneRegistry.release(id);
    sceneRegistry.release("unknown"); // no-op
    expect(sceneRegistry.size).toBe(0);
  });

  it("turns on shadows when asked: the renderer's switch, shaders prepared, redraws recorded", async () => {
    const { scene, renderer, s, context } = setup({ shadows: { radius: 10 } });
    Object.assign(renderer, { shadowMap: { enabled: false } });
    await scene.attach(context as never, size);
    expect((renderer as unknown as { shadowMap: { enabled: boolean } }).shadowMap.enabled).toBe(true);
    const box = new THREE.Mesh(new THREE.BoxGeometry());
    scene.scene.add(box);
    // The look's key light casts.
    expect(scene.shadows?.update(scene.camera)).toBe(true);
    expect(scene.shadows?.casting).toHaveLength(1);
    scene.invalidate();
    s.step();
    s.step();
    const frames = scene.report().recentFrames;
    expect(frames.at(-1)?.shadowMap).toBe(false);
    box.position.x = 2;
    scene.invalidate();
    s.step();
    // The shadow update brought matrices up to date: three's own pass is skipped, then restored.
    const seen: boolean[] = [];
    const render = renderer.render.bind(renderer);
    renderer.render = ((root: THREE.Scene, cam: THREE.Camera) => {
      seen.push(root.matrixWorldAutoUpdate);
      return render(root, cam);
    }) as typeof renderer.render;
    scene.invalidate();
    s.step();
    expect(seen.at(-1)).toBe(false);
    expect(scene.scene.matrixWorldAutoUpdate).toBe(true);
    // Redrawn once for the move (the first redraw was the update() above), not on still frames.
    expect(scene.report().recentFrames.filter((f) => f.shadowMap)).toHaveLength(1);
    expect(scene.shadows?.redraws).toBe(2);
    // Without the option: no shadows at all.
    const plain = setup();
    await plain.scene.attach(plain.context as never, size);
    expect(plain.scene.shadows).toBeNull();
  });

  it("reports GPU errors once each, which react-native-webgpu gives only to event listeners", async () => {
    const { scene, renderer, context } = setup();
    const listeners: ((event: { error?: { message?: string } }) => void)[] = [];
    Object.assign(renderer, {
      backend: {
        device: {
          addEventListener: (_type: string, listener: (typeof listeners)[number]) => listeners.push(listener),
        },
      },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await scene.attach(context as never, size);
    expect(listeners).toHaveLength(1);
    listeners[0]({ error: { message: "Invalid RenderPipeline (shadow)" } });
    listeners[0]({ error: { message: "Invalid RenderPipeline (shadow)" } });
    listeners[0]({});
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith("[apricot] GPU error:", "Invalid RenderPipeline (shadow)");
    const notes = JSON.stringify(scene.report().events);
    expect(notes).toContain("Invalid RenderPipeline (shadow)");
    expect(notes).toContain("Unknown GPU error");
    logged.mockRestore();
    scene.detach();
  });
  it("tells three to read shadows without comparison samplers when the GPU refuses them (Metal on some iPhones)", async () => {
    for (const refused of [true, false]) {
      const { scene, renderer, context } = setup();
      const compatibility: Record<string, boolean> = { depthTextureCompare: true };
      const samplers: unknown[] = [];
      Object.assign(renderer, {
        backend: {
          _compatibility: compatibility,
          device: {
            pushErrorScope: () => {},
            createSampler: (descriptor: unknown) => samplers.push(descriptor),
            popErrorScope: async () => (refused ? { message: "Compare functions are disabled" } : null),
          },
        },
      });
      await scene.attach(context as never, size);
      expect(samplers).toEqual([{ compare: "less-equal" }]);
      expect(compatibility.depthTextureCompare).toBe(!refused);
      expect(JSON.stringify(scene.report().events).includes("no comparison samplers")).toBe(refused);
      scene.detach();
    }
  });
  it("uses the tone mapping and exposure asked for, over the look's", async () => {
    const { renderer, scene, context } = setup({ toneMapping: "neutral", exposure: 1.2, warmUp: false });
    await scene.attach(context as never, size);
    expect(renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(renderer.toneMappingExposure).toBe(1.2);
    scene.detach();
    const plain = setup({ look: "none", toneMapping: "none", warmUp: false });
    await plain.scene.attach(plain.context as never, size);
    expect(plain.renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(plain.renderer.toneMappingExposure).toBeUndefined();
  });
  it("times the GPU when asked, for the report and the HUD", async () => {
    const { s, renderer, scene, context } = setup({ gpuTiming: true, warmUp: false });
    let resolve: (ms: number) => void = () => {};
    const asked = vi.fn(() => new Promise<number>((done) => (resolve = done)));
    Object.assign(renderer, { resolveTimestampsAsync: asked });
    const made: unknown[] = [];
    const timed = new ApricotScene({
      scheduler: s.scheduler,
      gpuTiming: true,
      createRenderer: (options) => {
        made.push(options);
        return renderer;
      },
    });
    await timed.attach(context as never, size);
    expect(made[0]).toMatchObject({ trackTimestamp: true });
    timed.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    timed.invalidate();
    s.step();
    expect(timed.gpuMs).toBeNull();
    // One ask at a time.
    timed.invalidate();
    s.step();
    expect(asked).toHaveBeenCalledTimes(1);
    resolve(4.25);
    await Promise.resolve();
    await Promise.resolve();
    expect(timed.gpuMs).toBe(4.25);
    timed.invalidate();
    s.step();
    const report = timed.report();
    expect(report.recentFrames.at(-1)).toMatchObject({ gpu: 4.25 });
    expect(report.summary).toHaveProperty("gpuMs");
    void scene;
  });
  it("lights with dynamic lighting on request, and makes the lamp lights", async () => {
    const renderer = Object.assign(fakeRenderer(), { isWebGPURenderer: true, lighting: null as unknown });
    const s = manualScheduler();
    const scene = new ApricotScene({
      scheduler: s.scheduler,
      createRenderer: () => renderer,
      lighting: "dynamic",
      lamps: 20,
    });
    await scene.attach(fakeContext() as never, size);
    expect((renderer.lighting as { options: { maxPointLights: number } }).options.maxPointLights).toBe(20);
    expect(scene.lamps.lights).toHaveLength(20);
    const standard = Object.assign(fakeRenderer(), { isWebGPURenderer: true, lighting: null as unknown });
    const plain = new ApricotScene({ scheduler: s.scheduler, createRenderer: () => standard, lamps: 2 });
    await plain.attach(fakeContext() as never, size);
    expect(standard.lighting).toBeNull();
    expect(plain.lamps.lights).toHaveLength(2);
  });
});
