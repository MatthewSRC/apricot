import type * as THREE from "three/webgpu";
import type { Diagnostics } from "../diagnostics";
import type { SceneOcclusion } from "../occlusion";
import type { SceneShadows } from "../shadows";
import { quickYieldsApply, withQuickYields } from "../yields";
import { compileRoots, exposeForCompile } from "./compile";
import type { FrameExclusions } from "./exclusions";
import * as lane from "./lane";
import { hasLight, hasMesh, inScene, nameOf, outermost, within } from "./objects";
import type { SceneRenderer } from "./types";

// Above this many roots, a warm-up compiles the whole scene instead. Each root
// compiled on its own walks the whole scene for its lights, while compiling
// the scene once is quick for what is already compiled.
const MANY_ROOTS = 8;
// Longest wait for the warm-up before a scene's first frame with content (ms).
// Waiting shows the loading cover; drawing first compiles every shader in that
// frame and freezes the app.
const HOLD_AT_MOST = 12000;
// Longest time frames wait for the warm-up of changed objects after the first frame (ms).
const CHANGES_AT_MOST = 300;
// Compile slices (ms): long while nothing moves on screen, short otherwise.
const LONG_SLICE = 50;
const SHORT_SLICE = 8;
// Delay before warming up the whole scene, so a burst of changes is compiled together (ms).
const WHOLE_DELAY = 50;

/** What a SceneWarmUp needs from its scene. */
export interface WarmUpHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly diagnostics: Diagnostics;
  readonly shadows: SceneShadows | null;
  readonly exclusions: FrameExclusions;
  /** False when the scene's `warmUp` option is false. */
  enabled(): boolean;
  renderer(): SceneRenderer | null;
  occlusion(): SceneOcclusion | null;
  /** A number that changes each time the scene detaches. */
  generation(): number;
  paused(): boolean;
  /** Sets up a shared renderer for this scene before compiling with it. */
  aim(): void;
  invalidate(): void;
}

type CompiledWaiter = { object: THREE.Object3D; resolve: () => void };

/**
 * A scene's shader warm-up: compiles shaders in the background, takes turns
 * with other scenes (see lane), and decides when frames wait for it.
 *
 * Before the first frame with content, frames wait for the whole scene to
 * compile. After that, frames wait briefly for changed objects, and new
 * objects are left out of frames until their shaders are ready.
 */
export class SceneWarmUp implements lane.LaneMember {
  /** Whether a warm-up is scheduled and has not started yet. */
  pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDelay = 0;
  private timerSetAt = -1;
  private warming: Promise<void> | null = null;
  // A warm-up was requested while one was running: run again when it ends.
  private again = false;
  // What the next warm-up compiles: the whole scene, or these roots.
  private whole = false;
  private readonly roots = new Set<THREE.Object3D>();
  // Whether a warm-up of the whole scene has started. The first one is always whole.
  private warmedWhole = false;
  // The running warm-up compiles objects already in view, so frames wait for it.
  private warmingChanges = false;
  // Objects already in view changed and wait for the next warm-up.
  private changesRequested = false;
  private changesSince = -1;
  // True until the first frame with content.
  private holding = true;
  private holdStarted = -1;
  private readonly readyListeners = new Set<() => void>();
  private compiledWaiters: CompiledWaiter[] = [];

  constructor(private readonly host: WarmUpHost) {}

  get paused() {
    return this.host.paused();
  }

  /** True once the scene draws its content. */
  get ready() {
    return !this.holding;
  }

  /** Whether a warm-up is running. */
  get running() {
    return this.warming !== null;
  }

  onReady(listener: () => void) {
    if (!this.holding) {
      listener();
      return () => {};
    }
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  /** Joins the lane when the scene attaches. */
  joinLane() {
    lane.attached.add(this);
  }

  /** Follows the scene being paused or resumed. */
  setPaused(paused: boolean, attached: boolean) {
    if (paused) lane.showing.delete(this);
    else if (attached && !this.holding) lane.showing.add(this);
  }

  /** Stops when the scene detaches: resolves the compiled() waiters and leaves the lane. */
  stop() {
    this.settleCompiled();
    lane.leaveLane(this);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** See ApricotScene.warmUp. */
  async run() {
    const { diagnostics, scene, camera, exclusions } = this.host;
    const renderer = this.host.renderer();
    if (!renderer?.compileAsync) {
      this.pending = false;
      this.settleCompiled();
      lane.nextInLane();
      return;
    }
    if (this.warming) {
      this.again = true;
      return this.warming;
    }
    // Stays pending while it waits, so first frames keep waiting too.
    if (!lane.mayWarmUp(this)) {
      if (!lane.waiting.has(this)) {
        lane.waiting.add(this);
        diagnostics.note("warm-up waits for another scene");
      }
      return;
    }
    lane.waiting.delete(this);
    lane.running.add(this);
    this.pending = false;
    const started = diagnostics.time();
    const generation = this.host.generation();
    const whole = this.whole || !this.warmedWhole || this.roots.size === 0;
    if (whole) this.warmedWhole = true;
    const asked = whole ? [scene] : outermost([...this.roots], scene);
    const together = asked.length > MANY_ROOTS;
    const roots = together ? [scene] : asked;
    this.whole = false;
    this.roots.clear();
    // New objects added before this warm-up started are shown when it ends.
    const revealed = exclusions.newObjects();
    const covered = this.compiledWaiters.filter(
      (w) => inScene(w.object, scene) && roots.some((root) => within(w.object, root)),
    );
    this.warmingChanges = !whole && asked.some((root) => !exclusions.excludes(root));
    this.changesRequested = false;
    this.host.aim();
    // Shadows change shaders, so casters and receivers are decided before compiling.
    this.host.shadows?.prepare();
    // Restored only when compiling ends: with occlusion, the second pass collects objects later.
    const { meshes, restore } = exposeForCompile(roots, camera);
    // three pauses for a whole frame between steps when the platform has no scheduler.yield,
    // which makes a warm-up take seconds.
    const quick = quickYieldsApply();
    // Long slices only while frames wait for this warm-up and no other scene shows.
    // Asked at each pause, since another scene may start showing meanwhile.
    const slice = () =>
      (this.holding || this.warmingChanges) && !lane.othersShowing(this) ? LONG_SLICE : SHORT_SLICE;
    diagnostics.note("warm-up started", {
      ...(whole
        ? { whole }
        : {
            objects: meshes,
            of: asked.slice(0, 5).map(nameOf),
            ...(asked.length > 5 ? { andMore: asked.length - 5 } : {}),
            ...(together ? { together } : {}),
          }),
      ...(quick ? { slice: slice() } : {}),
    });
    let compiling: Promise<void>;
    try {
      // compileAsync collects objects synchronously, before its first await. It is given no
      // progress callback: three reports progress with ProgressEvent, which Hermes lacks.
      const occlusion = this.host.occlusion();
      const compile = () => compileRoots(renderer, occlusion, roots, scene, camera);
      compiling = quick ? withQuickYields(compile, slice) : compile();
    } catch (error) {
      restore();
      throw error;
    }
    this.warming = compiling
      .finally(restore)
      .then(() =>
        diagnostics.note("warm-up done", {
          ms: Math.round(diagnostics.time() - started),
          objects: meshes,
          quick,
        }),
      )
      .catch((e: unknown) => {
        // The scene detached and its renderer is being freed.
        if (this.host.generation() !== generation) {
          diagnostics.note("warm-up stopped", { why: "the scene left" });
          return;
        }
        diagnostics.note("warm-up failed", { error: String(e) });
        console.warn("[apricot] Shader warm-up failed:", e);
      })
      .finally(() => {
        this.warming = null;
        this.warmingChanges = false;
        exclusions.reveal(revealed);
        this.settleCompiled(covered);
        // Frames held for the warm-up, and new objects left out of them, can be drawn now.
        this.host.invalidate();
        if (this.again) {
          this.again = false;
          this.schedule();
        }
        // Other scenes' turn comes after this one's next warm-up is scheduled, so a paused
        // scene waits for it.
        if (lane.running.delete(this)) lane.nextInLane();
      });
    return this.warming;
  }

  /** See ApricotScene.requestWarmUp. */
  request(object?: THREE.Object3D, { added = false }: { added?: boolean } = {}) {
    if (!this.host.enabled() || !this.host.renderer()?.compileAsync) return;
    if (!object || hasLight(object)) this.whole = true;
    else {
      this.roots.add(object);
      // Before the first frame, frames wait for the whole scene anyway.
      if (added && !this.holding) this.host.exclusions.keepNew(object, this.host.diagnostics.time());
      // An object not in the scene yet is about to be added.
      else if (inScene(object, this.host.scene)) this.changesRequested = true;
    }
    if (this.warming) this.again = true;
    else this.schedule();
  }

  /** See ApricotScene.compiled. */
  compiled(object: THREE.Object3D, { timeout = 15000 }: { timeout?: number } = {}): Promise<void> {
    const renderer = this.host.renderer();
    if (!this.host.enabled() || (renderer && !renderer.compileAsync)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = {
        object,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => this.settleCompiled([waiter]), timeout);
      this.compiledWaiters.push(waiter);
      // A warm-up of its own, quick if its shaders are compiled already: one that ran before the
      // object was added did not compile it. It is not kept out as new, so it stays if it shows.
      if (!renderer?.compileAsync) return;
      if (hasLight(object)) this.whole = true;
      else this.roots.add(object);
      if (this.warming) this.again = true;
      else this.schedule();
    });
  }

  // Resolves the compiled() waiters in `done`, or all of them.
  private settleCompiled(done = this.compiledWaiters) {
    if (done.length === 0) return;
    const settled = new Set(done);
    this.compiledWaiters = this.compiledWaiters.filter((w) => !settled.has(w));
    for (const w of settled) w.resolve();
  }

  private schedule() {
    this.pending = true;
    // The whole scene waits for a burst of changes to settle (a screen mounting). Parts start at
    // once, since frames may wait for them.
    const delay = this.whole || !this.warmedWhole ? WHOLE_DELAY : 0;
    const now = this.host.diagnostics.time();
    // During a burst of requests, the timer just set is kept rather than replaced each time.
    if (this.timer && delay === this.timerDelay && now - this.timerSetAt < 5) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDelay = delay;
    this.timerSetAt = now;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  /**
   * After the first frame: whether to skip drawing while the shaders of
   * changed objects compile. The last frame stays on screen for up to
   * 300 ms instead of a frame compiling them and stalling. New objects do not
   * hold frames; they are left out of them instead.
   */
  holdForChanges() {
    if (this.holding || !(this.warmingChanges || (this.pending && this.changesRequested))) {
      this.changesSince = -1;
      return false;
    }
    const now = this.host.diagnostics.time();
    if (this.changesSince < 0) this.changesSince = now;
    return now - this.changesSince < CHANGES_AT_MOST;
  }

  /**
   * Before the first frame with content: whether frames show only the
   * background while the warm-up runs, for up to 12 s. Otherwise that frame
   * compiles every shader at once and freezes the app. Ends the hold at the
   * first frame with a mesh once the warm-up is done or the time is up.
   */
  holdForWarmUp() {
    if (!this.holding) return false;
    const { diagnostics, scene } = this.host;
    const waiting = this.pending || this.warming !== null;
    const now = diagnostics.time();
    if (waiting) {
      if (this.holdStarted < 0) {
        this.holdStarted = now;
        diagnostics.note("first frames held for the warm-up");
      }
      if (now - this.holdStarted < HOLD_AT_MOST) return true;
    }
    if (hasMesh(scene)) {
      this.holding = false;
      if (!this.host.paused()) lane.showing.add(this);
      diagnostics.note("first frame", {
        heldMs: this.holdStarted < 0 ? 0 : Math.round(now - this.holdStarted),
      });
      // One more frame, so frame callbacks that check `ready` (labels) show.
      this.host.invalidate();
      const listeners = [...this.readyListeners];
      this.readyListeners.clear();
      for (const listener of listeners) listener();
    }
    return false;
  }
}
