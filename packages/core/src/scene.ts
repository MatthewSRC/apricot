import * as THREE from "three/webgpu";
import type { StillGroup } from "./bundle";
import type { Pixels } from "./capture";
import { adapterInfo, Diagnostics, rendererCounters, sceneContents } from "./diagnostics";
import { applyEnvironment } from "./environment";
import { LampPool } from "./lamps";
import { applyLook } from "./look";
import { type FrameCallback, FrameLoop } from "./loop";
import { canOcclude, SceneOcclusion } from "./occlusion";
import { PressRouter } from "./press";
import { DEFAULT_MAX_PIXEL_RATIO, drawingBufferSize, resolvePixelRatio } from "./quality";
import { SceneRegistry } from "./registry";
import {
  canvasTargetFor,
  checkTextureCompare,
  createRenderer,
  disposeRenderer,
  freeCanvasTarget,
  isWebGLContext,
  sharedDevice,
  sharedDeviceProblem,
  sharedRenderer,
} from "./renderer";
import { SharedRendererAim } from "./scene/aim";
import { recheckBundles } from "./scene/bundles";
import { ScreenColors } from "./scene/colors";
import { FrameExclusions } from "./scene/exclusions";
import { nextInLane } from "./scene/lane";
import { patchRenderer, reportGpuErrors } from "./scene/setup";
import {
  type AttachOptions,
  type CanvasContext,
  type LayoutSize,
  type SceneOptions,
  type SceneRenderer,
  toneMappingFor,
} from "./scene/types";
import { DrawnWaiters, FrameCaptures } from "./scene/waiters";
import { SceneWarmUp } from "./scene/warm-up";
import { SceneShadows } from "./shadows";
import { FrameStats } from "./stats";

export { compileWhileHidden } from "./scene/objects";
export type {
  AttachOptions,
  CameraOptions,
  CanvasContext,
  SceneOptions,
  SceneRenderer,
  ToneMappingName,
} from "./scene/types";

// Only React Native has present(); browsers present on their own.
const present = (context: CanvasContext) => {
  if (!isWebGLContext(context)) context.present?.();
};

// Delay before a detached scene's renderer is freed (ms), so it happens after the screen's exit transition.
const FREE_AFTER = 1000;

/**
 * A 3D scene with its camera, renderer and frame loop. Scenes are created
 * through a SceneRegistry, so a scene's lifetime is separate from any one
 * canvas. It is detached when its last user releases it.
 */
export class ApricotScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  readonly stats = new FrameStats();
  /** Performance recorder. See report(). */
  readonly diagnostics = new Diagnostics();
  readonly loop: FrameLoop;
  /** Routes taps on the canvas to the objects that listen for them. */
  readonly presses = new PressRouter();
  /** The scene's still groups (see StillGroup), checked for changes before every frame. */
  readonly bundles = new Set<StillGroup>();
  /**
   * The point the camera looks at, when known. <CameraRig> sets it every
   * frame. Shadows with a `radius` are centred on it.
   */
  focus: THREE.Vector3 | null = null;
  /** The scene's shadows, or null without the `shadows` option. */
  readonly shadows: SceneShadows | null;
  /** The lights that lamps share (see the `lamps` option). */
  readonly lamps: LampPool;
  /** GPU time of the latest measured frames in ms, or null until known or without `gpuTiming`. */
  gpuMs: number | null = null;

  private readonly options: SceneOptions;
  private renderer: SceneRenderer | null = null;
  private occlusion: SceneOcclusion | null = null;
  private context: CanvasContext | null = null;
  // Gives back a shared renderer; null when the scene has its own.
  private releaseRenderer: (() => void) | null = null;
  private readonly aim: SharedRendererAim;
  private readonly warmUps: SceneWarmUp;
  private readonly exclusions = new FrameExclusions();
  private readonly drawnWaiters: DrawnWaiters;
  private readonly captures = new FrameCaptures();
  private readonly colors = new ScreenColors();
  // Draws only the background colour while the first frames wait for the warm-up.
  private readonly holdScene = new THREE.Scene();
  private readonly resizeListeners = new Set<(size: { width: number; height: number }) => void>();
  private size_ = { width: 0, height: 0, devicePixelRatio: 1 };
  private paused = false;
  // Incremented by detach(), so an attach() still starting knows to give up.
  private generation = 0;
  private lastFrameAt = -1;
  private timingGpu = false;
  // Scratch array for the scene's lights (see recheckBundles).
  private readonly lights: THREE.Light[] = [];

  constructor(options: SceneOptions = {}) {
    this.options = options;
    const shadows = options.shadows;
    this.shadows = shadows ? new SceneShadows(this.scene, shadows === true ? {} : shadows) : null;
    this.lamps = new LampPool(this.scene, options.lamps ?? 0, options.lighting === "dynamic");
    this.aim = new SharedRendererAim(options);
    this.drawnWaiters = new DrawnWaiters(() => this.diagnostics.time());
    this.warmUps = new SceneWarmUp({
      scene: this.scene,
      camera: this.camera,
      diagnostics: this.diagnostics,
      shadows: this.shadows,
      exclusions: this.exclusions,
      enabled: () => this.options.warmUp !== false,
      renderer: () => this.renderer,
      occlusion: () => this.occlusion,
      generation: () => this.generation,
      paused: () => this.paused,
      aim: () => this.aim.apply(this.renderer),
      invalidate: () => this.invalidate(),
    });
    this.setUpCamera();
    this.setUpLighting();
    this.loop = new FrameLoop({
      mode: options.frameloop,
      scheduler: options.scheduler,
      render: () => this.render(),
      onIdle: () => this.stats.markIdle(),
      linger: options.linger ?? 0.25,
    });
    // Added first, so it runs before other frame callbacks and they draw with this scene's
    // canvas and settings on a shared renderer (a blur, an environment).
    this.loop.add(() => {
      this.aim.begin(this.renderer);
    });
  }

  private setUpCamera() {
    const {
      position = [0, 0, 6],
      target = [0, 0, 0],
      fov = 50,
      near = 0.1,
      far = 200,
    } = this.options.camera ?? {};
    this.camera.near = near;
    this.camera.far = far;
    this.camera.position.set(...position);
    this.camera.fov = fov;
    this.camera.lookAt(...target);
  }

  // The look, background, environment and fog.
  private setUpLighting() {
    const { options, scene } = this;
    const look = options.look ?? "soft";
    if (look !== "none")
      applyLook(scene, look, { background: !options.transparent, shadows: !!options.shadows });
    if (options.background !== undefined && !options.transparent) {
      scene.background = new THREE.Color(options.background);
    }
    if (options.environment && options.environment !== "none") applyEnvironment(scene, options.environment);
    if (options.fog) {
      const { near = 30, far = 90, color } = options.fog === true ? {} : options.fog;
      const background = scene.background instanceof THREE.Color ? scene.background : null;
      scene.fog = new THREE.Fog(color ?? background ?? "#ffffff", near, far);
    }
  }

  get isAttached() {
    return this.renderer !== null;
  }

  /** The three.js renderer once attached, for advanced use. */
  get threeRenderer() {
    return this.renderer;
  }

  /** Layout size in points (0 × 0 until attached). */
  get size(): { readonly width: number; readonly height: number } {
    return this.size_;
  }

  /** Calls `listener` after every resize(). Returns the remover. */
  onResize(listener: (size: { width: number; height: number }) => void) {
    this.resizeListeners.add(listener);
    return () => {
      this.resizeListeners.delete(listener);
    };
  }

  /**
   * Starts drawing into `context`. The renderer is shared with other scenes
   * when the shared GPU device is available, unless `shareDevice` is false
   * or `createRenderer` is set. A WebGL 2 context gets a renderer of its own
   * that draws with three's WebGL 2 backend. Throws if the scene is already
   * attached.
   */
  async attach(context: CanvasContext, { width, height, devicePixelRatio, device }: AttachOptions) {
    if (this.renderer) throw new Error("ApricotScene is already attached to a canvas");
    const generation = this.generation;
    const webgl = isWebGLContext(context);
    const shareable = this.options.shareDevice !== false && !this.options.createRenderer && !webgl;
    const onDevice = webgl ? undefined : (device ?? (shareable ? await sharedDevice() : undefined));
    if (generation !== this.generation) return;
    const toneMapping = toneMappingFor(this.options);
    this.aim.toneMapping = toneMapping;
    const dynamic = this.options.lighting === "dynamic" ? Math.max(16, this.options.lamps ?? 0) : 0;
    const size = { width, height, devicePixelRatio };
    let renderer: SceneRenderer;
    let textureCompare: boolean;
    if (shareable && onDevice) {
      // Scenes whose settings lead to the same shaders share a renderer, so shaders compile once.
      const shared = await sharedRenderer({
        key: [dynamic, this.shadows?.type ?? "none", this.options.gpuTiming ? "timed" : ""].join("|"),
        device: onDevice,
        trackTimestamp: this.options.gpuTiming === true,
        setup: (made) => {
          patchRenderer(made, dynamic);
          if (this.shadows) {
            made.shadowMap.enabled = true;
            made.shadowMap.type = this.shadows.type;
          }
        },
        check: checkTextureCompare,
        freeAfter: FREE_AFTER,
      });
      if (generation !== this.generation) {
        shared.release();
        return;
      }
      renderer = shared.renderer as unknown as SceneRenderer;
      textureCompare = shared.textureCompare;
      this.releaseRenderer = shared.release;
      this.aim.target = canvasTargetFor(context);
      this.renderer = renderer;
      this.aim.apply(renderer);
      this.applySize(renderer, context, size);
    } else {
      const own = (this.options.createRenderer ?? createRenderer)({
        context,
        device: onDevice,
        ...(this.options.gpuTiming ? { trackTimestamp: true } : {}),
      });
      patchRenderer(own, dynamic);
      this.applySize(own, context, size);
      own.toneMapping = toneMapping;
      if (this.options.exposure !== undefined) own.toneMappingExposure = this.options.exposure;
      if (this.options.transparent) own.setClearColor(0x000000, 0);
      if (this.shadows && own.shadowMap) {
        own.shadowMap.enabled = true;
        own.shadowMap.type = this.shadows.type;
      }
      await own.init();
      textureCompare = await checkTextureCompare(own);
      if (generation !== this.generation) {
        disposeRenderer(own);
        return;
      }
      renderer = own;
    }

    this.renderer = renderer;
    this.context = context;
    const occlusion = this.options.occlusion;
    if (occlusion && canOcclude(renderer))
      this.occlusion = new SceneOcclusion(
        renderer,
        this.scene,
        this.camera,
        occlusion === true ? {} : occlusion,
      );
    reportGpuErrors(renderer, this.diagnostics);
    if (!textureCompare) this.diagnostics.note("no comparison samplers", { shadows: "read without them" });
    this.diagnostics.note("attached", {
      width,
      height,
      devicePixelRatio,
      sharedDevice: onDevice !== undefined,
      sharedRenderer: this.aim.target !== null,
      ...(webgl ? { backend: "webgl" } : {}),
      ...(shareable && onDevice === undefined ? { why: sharedDeviceProblem() } : {}),
    });
    this.warmUps.joinLane();
    // A scene paused before it attached still warms up, and draws once resumed.
    this.runLoop();
    this.requestWarmUp();
  }

  /** Applies a new layout size, for example after the view is resized or the screen rotates. */
  resize({ width, height, devicePixelRatio }: LayoutSize) {
    const { size_: current } = this;
    if (width <= 0 || height <= 0) return;
    if (current.width === width && current.height === height && current.devicePixelRatio === devicePixelRatio)
      return;
    if (!this.renderer || !this.context) return;
    this.applySize(this.renderer, this.context, { width, height, devicePixelRatio });
    for (const listener of this.resizeListeners) listener(this.size_);
    this.invalidate();
  }

  private applySize(
    renderer: SceneRenderer,
    context: CanvasContext,
    { width, height, devicePixelRatio }: LayoutSize,
  ) {
    const pixelRatio = resolvePixelRatio(
      devicePixelRatio,
      this.options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO,
    );
    const size = drawingBufferSize(width, height, pixelRatio);
    const canvas = context.canvas as HTMLCanvasElement;
    canvas.width = size.width;
    canvas.height = size.height;
    const target = this.aim.target;
    if (target) {
      // The canvas target must be the current one while it is resized: the renderer then drops
      // the buffers it kept for the old size.
      this.aim.apply(this.renderer);
      target.setPixelRatio(1);
      target.setSize(size.width, size.height, false);
    } else {
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
    }
    this.size_ = { width, height, devicePixelRatio };
    this.camera.aspect = size.width / size.height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Stops drawing immediately and frees the renderer and its GPU memory one
   * second later. Freeing it while the screen transitions out would stall
   * the transition.
   */
  detach() {
    this.generation++;
    this.warmUps.stop();
    this.loop.stop();
    const { renderer, occlusion, releaseRenderer } = this;
    const target = this.aim.target;
    this.occlusion = null;
    this.renderer = null;
    this.context = null;
    this.aim.target = null;
    this.releaseRenderer = null;
    if (renderer)
      setTimeout(() => {
        occlusion?.dispose();
        // A shared renderer only frees this scene's canvas buffers and is given back.
        if (target && releaseRenderer) {
          freeCanvasTarget(renderer, target);
          releaseRenderer();
        } else disposeRenderer(renderer);
      }, FREE_AFTER);
    this.captures.rejectAll("[apricot] capture: the scene left the screen");
    this.drawnWaiters.resolveAll();
  }

  /**
   * Pauses drawing (true) or resumes it (false), for a scene that is kept
   * but not visible, such as one under another screen or while the app is in
   * the background. The last frame stays on the canvas, and nothing runs each
   * frame. Shaders still warm up, after those of scenes being drawn. Before
   * the first frame, frame callbacks still run after changes (see runLoop).
   */
  pause(paused = true) {
    if (paused === this.paused) return;
    this.paused = paused;
    this.warmUps.setPaused(paused, this.renderer !== null);
    this.runLoop();
    if (!paused) {
      this.invalidate();
      // A scene being drawn may warm up alongside a paused one.
      nextInLane();
    }
  }

  /**
   * Runs or stops the frame loop to match pause(). A paused scene that has
   * not drawn its first frame keeps a quiet loop, which runs frames only
   * after a change and draws nothing. Work done in frame callbacks (merged
   * shapes, a model's parts) is then ready and warmed up when it is shown.
   */
  private runLoop() {
    if (!this.renderer) return;
    if (this.paused && this.warmUps.ready) {
      this.loop.stop();
      return;
    }
    this.loop.quiet = this.paused;
    this.loop.start();
  }

  /** Whether drawing is paused (see pause). */
  get isPaused() {
    return this.paused;
  }

  /** Whether the canvas is transparent (the `transparent` option), so nothing should paint a background. */
  get transparent() {
    return this.options.transparent === true;
  }

  /** Runs `callback` before every frame. Return `true` from it while animating. */
  onFrame(callback: FrameCallback) {
    return this.loop.add(callback);
  }

  /**
   * Handles a tap at (x, y), in points from the canvas's top-left corner. The
   * nearest object listening for taps (see `presses`) receives it. Returns
   * the hit.
   */
  press(x: number, y: number) {
    return this.presses.press(this.camera, x, y, this.size_.width, this.size_.height);
  }

  /**
   * Compiles shaders in the background with three's compileAsync, including
   * those of objects out of view. The first warm-up compiles the whole
   * scene; later ones compile what was requested since (see requestWarmUp).
   * Without a warm-up, an object's shaders compile the first time it is
   * drawn, which stalls that frame.
   */
  warmUp(): Promise<void> {
    return this.warmUps.run();
  }

  /**
   * Schedules a shader warm-up once a burst of changes settles. Call it after
   * adding objects or changing materials. With `object`, only it and its
   * children are compiled, with the scene's lights. Without it, or when it
   * contains a light (which changes every shader it shines on), the whole
   * scene is compiled. Until the warm-up is done, frames wait for up to
   * 300 ms and the last frame stays on screen. With `added`, the object is
   * new: frames do not wait but leave it out until its shaders are ready,
   * for up to 1.5 s, so moving things keep moving.
   */
  requestWarmUp(object?: THREE.Object3D, options: { added?: boolean } = {}) {
    this.warmUps.request(object, options);
  }

  /**
   * Leaves `object` and its children out of frames until the returned
   * function is called. Use it to prepare the next thing to show, with its
   * shaders compiled under the scene's lights, while the current one stays
   * on screen: wait for `compiled`, then swap the two. `drawn` does not wait
   * for held-back objects.
   *
   *   const show = scene.holdBack(next);
   *   await scene.compiled(next);
   *   previous.removeFromParent();
   *   show();
   */
  holdBack(object: THREE.Object3D): () => void {
    this.exclusions.hold(object);
    this.invalidate();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.exclusions.release(object);
      this.invalidate();
    };
  }

  /**
   * Resolves once `object`'s shaders are compiled by the warm-up that follows
   * its addition to the scene. Resolves at once when warm-ups are off, and
   * also after `timeout` ms (default 15000) or when the scene detaches.
   */
  compiled(object: THREE.Object3D, options: { timeout?: number } = {}): Promise<void> {
    return this.warmUps.compiled(object, options);
  }

  /** True once the scene draws its content, after the first frames held for the shader warm-up. */
  get ready() {
    return this.warmUps.ready;
  }

  /**
   * Calls `listener` once when the scene first draws its content, or at once
   * if it already does. Returns an unsubscribe function.
   */
  onReady(listener: () => void) {
    return this.warmUps.onReady(listener);
  }

  /**
   * Resolves once a frame shows everything added so far: no new object is
   * left out while its shaders compile, and the first frames' warm-up is
   * done. Wait for it after changing what the scene shows, before fading the
   * view in or taking a picture. After `timeout` ms (default 3000) it
   * resolves at the next frame regardless, and at once if the scene detaches.
   *
   *   setPiece(next);
   *   await scene.drawn();
   *   fadeIn();
   */
  drawn({ timeout = 3000 }: { timeout?: number } = {}): Promise<void> {
    if (!this.renderer) return Promise.resolve();
    return new Promise((resolve) => {
      this.drawnWaiters.add(timeout, resolve);
      this.invalidate();
    });
  }

  /**
   * The pixels of the next frame as the screen shows it (with its look,
   * shadows and occlusion), once the scene is ready. The size is the drawing
   * size: the view's size times its pixel ratio. captureScene
   * (@apricotjs/react-native/capture) saves it as an image.
   */
  async capture(): Promise<Pixels> {
    if (!this.renderer) throw new Error("[apricot] capture: the scene is not on screen");
    await new Promise<void>((resolve) => this.onReady(resolve));
    // Waits until new objects are no longer left out while their shaders compile.
    await this.drawn();
    if (!this.renderer) throw new Error("[apricot] capture: the scene left the screen");
    const pixels = this.captures.next();
    this.invalidate();
    return pixels;
  }

  /** Requests a frame. Needed in "demand" mode after changing the scene outside onFrame. */
  invalidate() {
    this.loop.invalidate();
  }

  private render() {
    try {
      this.drawFrame();
    } finally {
      this.aim.end(this.renderer);
    }
  }

  private drawFrame() {
    if (!this.renderer || !this.context) return;
    // A paused scene getting ready (see runLoop) runs frame callbacks but draws nothing.
    if (this.paused) return;
    // The last frame stays on screen; the warm-up requests a frame when it is done.
    if (this.warmUps.holdForChanges()) return;
    if (this.warmUps.holdForWarmUp()) {
      this.drawBackgroundOnly(this.renderer, this.context);
      return;
    }
    const before = rendererCounters(this.renderer);
    const start = performance.now();
    // New objects still compiling are left out of this frame, bundles and shadow maps included.
    const showExcluded = this.exclusions.hideForFrame(this.diagnostics.time());
    const complete = showExcluded === null || this.exclusions.newCount === 0;
    let rerecorded = 0;
    let shadowMap = false;
    try {
      rerecorded = recheckBundles(this.scene, this.bundles, this.lights);
      shadowMap = this.shadows?.update(this.camera, this.focus) ?? false;
      this.lamps.update();
      this.stats.begin();
      // The shadow update already brought every world matrix up to date.
      const auto = this.scene.matrixWorldAutoUpdate;
      if (this.shadows) this.scene.matrixWorldAutoUpdate = false;
      const restoreColors = this.colors.swap(this.scene, this.renderer);
      try {
        if (this.occlusion) this.occlusion.render();
        else this.renderer.render(this.scene, this.camera);
      } finally {
        restoreColors();
        this.scene.matrixWorldAutoUpdate = auto;
      }
    } finally {
      showExcluded?.();
    }
    if (this.captures.pending) this.captures.read(this.renderer, this.context);
    if (this.drawnWaiters.frameDrawn(complete)) this.invalidate();
    const rendered = performance.now();
    this.timeGpu();
    this.stats.beforePresent();
    present(this.context);
    this.stats.end();
    const end = performance.now();
    const after = rendererCounters(this.renderer);
    this.diagnostics.frame({
      at: this.diagnostics.time(),
      interval: this.lastFrameAt < 0 ? 0 : start - this.lastFrameAt,
      callbacks: this.loop.callbacksMs,
      render: rendered - start,
      present: end - rendered,
      drawCalls: after.drawCalls,
      triangles: after.triangles,
      newPipelines: after.pipelines - before.pipelines,
      newShaders: after.shaders - before.shaders,
      newNodeBuilds: after.nodeBuilds - before.nodeBuilds,
      warming: this.warmUps.running,
      ...(this.shadows ? { shadowMap } : {}),
      ...(this.bundles.size ? { rerecorded } : {}),
      ...(this.gpuMs !== null ? { gpu: Math.round(this.gpuMs * 100) / 100 } : {}),
    });
    this.lastFrameAt = start;
  }

  // Clears to the background colour, which compiles no shaders.
  private drawBackgroundOnly(renderer: SceneRenderer, context: CanvasContext) {
    const { holdScene, camera } = this;
    holdScene.background = this.scene.background instanceof THREE.Color ? this.scene.background : null;
    const restoreColors = this.colors.swap(holdScene, renderer);
    try {
      const draw = () => renderer.render(holdScene, camera);
      if (this.occlusion) this.occlusion.toScreen(draw);
      else draw();
    } finally {
      restoreColors();
    }
    present(context);
  }

  // Asks for the GPU time of the frames drawn since the last ask, one ask at a time.
  private timeGpu() {
    const renderer = this.renderer;
    if (!this.options.gpuTiming || !renderer?.resolveTimestampsAsync || this.timingGpu) return;
    this.timingGpu = true;
    renderer
      .resolveTimestampsAsync("render")
      .then((ms) => {
        if (typeof ms === "number" && ms > 0) this.gpuMs = ms;
      })
      .catch(() => {})
      .finally(() => {
        this.timingGpu = false;
      });
  }

  /**
   * A performance report as plain JSON: frame times, the slowest frames and
   * what happened in them, events, scene contents and GPU details. `extra`
   * adds app details.
   */
  report<E extends Record<string, unknown> = Record<string, never>>(extra: E = {} as E) {
    const { environment } = this.options;
    return this.diagnostics.report({
      three: THREE.REVISION,
      gpu: adapterInfo(this.renderer),
      size: this.size_,
      shadows: this.shadows?.describe() ?? null,
      options: {
        frameloop: this.options.frameloop ?? "demand",
        look: this.options.look ?? "soft",
        environment: typeof environment === "string" ? environment : environment ? "custom" : "none",
        maxPixelRatio: this.options.maxPixelRatio,
        warmUp: this.options.warmUp !== false,
        occlusion: this.occlusion !== null,
      },
      scene: sceneContents(this.scene),
      caches: rendererCounters(this.renderer),
      stats: this.stats.summary(),
      ...extra,
    });
  }
}

export const sceneRegistry = new SceneRegistry<ApricotScene>();
