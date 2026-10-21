import * as THREE from "three/webgpu";

export interface CreateRendererOptions {
  /** A WebGPU canvas context, or a WebGL 2 context for a browser without WebGPU. */
  context: GPUCanvasContext | WebGL2RenderingContext;
  /** Renders on this device instead of requesting one, for example Skia's shared device. */
  device?: GPUDevice;
  antialias?: boolean;
  /** Records GPU timestamps where the device supports them (see resolveTimestampsAsync). */
  trackTimestamp?: boolean;
}

/** Whether `context` is a WebGL 2 context rather than a WebGPU one. */
export const isWebGLContext = (context: unknown): context is WebGL2RenderingContext =>
  typeof (context as { getExtension?: unknown } | null)?.getExtension === "function";

/** The message of the error a scene fails with where neither WebGPU nor WebGL 2 is available. */
export const NO_GPU_MESSAGE = "[apricot] WebGPU isn't available on this device";

// Without a WebGPU adapter three falls back to WebGL 2 on the renderer's own canvas, which a scene never
// draws into. The renderer fails to start instead, with a message that says why.
const withoutWebGLFallback = (renderer: THREE.WebGPURenderer) => {
  (renderer as unknown as { _getFallback: ((error: unknown) => never) | null })._getFallback = (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${NO_GPU_MESSAGE} (${reason})`);
  };
  return renderer;
};

/**
 * A three.js renderer bound to a react-native-webgpu canvas context. Given a
 * WebGL 2 context, it draws with three's WebGL 2 backend.
 */
export const createRenderer = ({
  context,
  device,
  antialias = true,
  trackTimestamp = false,
}: CreateRendererOptions) => {
  const webgl = isWebGLContext(context);
  const renderer = new THREE.WebGPURenderer({
    antialias,
    // alpha defaults to true and the context is configured "premultiplied",
    // so a clear alpha of 0 makes the canvas transparent.
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
    trackTimestamp,
    forceWebGL: webgl,
  } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
  return webgl ? renderer : withoutWebGLFallback(renderer);
};

type Gpu = {
  requestAdapter: (options?: Record<string, unknown>) => Promise<{
    features: { has: (name: string) => boolean };
    requestDevice: (descriptor: { requiredFeatures: string[] }) => Promise<GPUDevice>;
  } | null>;
};

// The features three requests when it creates its own device (GPUFeatureName in three r186). Each is
// checked with has() because react-native-webgpu's feature set cannot be iterated.
const FEATURES = [
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "timestamp-query",
  "indirect-first-instance",
  "shader-f16",
  "rg11b10ufloat-renderable",
  "bgra8unorm-storage",
  "float32-filterable",
  "float32-blendable",
  "clip-distances",
  "dual-source-blending",
  "subgroups",
  "texture-formats-tier1",
  "texture-formats-tier2",
];

let shared: Promise<GPUDevice | undefined> | null = null;
let problem: string | null = null;

/** Why the latest request for the shared device failed, or null. */
export const sharedDeviceProblem = () => problem;

/**
 * One GPU device for every scene, requested the way three requests its own
 * (compatibility feature level, every feature the adapter has). Resolves to
 * undefined where there is no WebGPU, as in tests. Without it, each
 * renderer requests a device when it starts and destroys it when it is
 * disposed, and both wait for the GPU. After the device is lost, the next
 * call requests a new one.
 */
export const sharedDevice = (): Promise<GPUDevice | undefined> => {
  if (shared) return shared;
  const gpu = (globalThis as { navigator?: { gpu?: Gpu } }).navigator?.gpu;
  if (!gpu) {
    problem = "no navigator.gpu";
    return Promise.resolve(undefined);
  }
  const forget = () => {
    if (shared === asked) shared = null;
  };
  const asked: Promise<GPUDevice | undefined> = (async () => {
    const adapter = await gpu.requestAdapter({ featureLevel: "compatibility" });
    if (!adapter) {
      problem = "no adapter";
      return undefined;
    }
    const requiredFeatures = FEATURES.filter((name) => adapter.features.has(name));
    const device = await adapter.requestDevice({ requiredFeatures });
    // Some implementations have no device.lost.
    void (device.lost as Promise<unknown> | undefined)?.then(forget);
    problem = null;
    return device;
  })()
    .catch((error: unknown) => {
      problem = String(error).slice(0, 300);
      return undefined;
    })
    .then((device) => {
      // Each renderer then requests its own device, and the next call tries again.
      if (!device) forget();
      return device;
    });
  shared = asked;
  return asked;
};

export type GpuSupport = "webgpu" | "webgl" | "none";

const canUseWebGL = () => {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
};

/**
 * What scenes draw with here: "webgpu", "webgl" in a browser that has no
 * WebGPU adapter but has WebGL 2, or "none", where scenes fail to start.
 */
export const gpuSupport = async (): Promise<GpuSupport> => {
  if (await sharedDevice()) return "webgpu";
  return canUseWebGL() ? "webgl" : "none";
};

/**
 * A three.js CanvasTarget that draws into `context`. With one target per
 * canvas, a single renderer draws several scenes and compiles their shaders
 * and pipelines once. Sizes set on the target are applied to the canvas.
 */
export const canvasTargetFor = (context: GPUCanvasContext) => {
  const canvas = context.canvas as { width: number; height: number };
  const element = {
    get width() {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height() {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    style: {},
    getContext: () => context,
  };
  return new THREE.CanvasTarget(element as unknown as HTMLCanvasElement);
};

type Backend = {
  get?: (object: object) => { texture?: { destroy?: () => void } };
  delete?: (object: object) => void;
};

/** Frees the frame, colour and depth buffers that `renderer` keeps for a canvas target. */
export const freeCanvasTarget = (renderer: unknown, target: THREE.CanvasTarget) => {
  target.dispose();
  const backend = (renderer as { backend?: Backend }).backend;
  for (const texture of [target.colorTexture, target.depthTexture]) {
    backend?.get?.(texture)?.texture?.destroy?.();
    backend?.delete?.(texture);
    texture.dispose();
  }
  backend?.delete?.(target);
};

interface Pooled {
  renderer: THREE.WebGPURenderer;
  device: GPUDevice | undefined;
  ready: Promise<boolean>;
  users: number;
  freeing: ReturnType<typeof setTimeout> | null;
}

const pool = new Map<string, Pooled>();

// A placeholder canvas for shared renderers. Each scene draws into its own canvas target.
const noCanvas = () =>
  ({
    width: 1,
    height: 1,
    style: {},
    getContext: () => null,
  }) as unknown as HTMLCanvasElement;

export interface SharedRendererOptions {
  /**
   * Scenes share a renderer when their keys match. The key covers every
   * setting that changes shaders or the renderer.
   */
  key: string;
  device: GPUDevice | undefined;
  trackTimestamp?: boolean;
  /** Called once on a new renderer before init, for patches, lighting and shadow settings. */
  setup: (renderer: THREE.WebGPURenderer) => void;
  /**
   * Called once after init. Its result, such as whether comparison samplers
   * work, is returned to every user.
   */
  check: (renderer: THREE.WebGPURenderer) => Promise<boolean>;
  /**
   * Delay in ms before the renderer is freed once its last user releases
   * it. A new user within that time keeps it.
   */
  freeAfter: number;
}

/**
 * A renderer shared by the scenes that ask with the same `key` on the same
 * device, so shaders and pipelines compiled for one are ready for the next.
 * Each scene draws into its own canvas (canvasTargetFor) and applies its own
 * settings before drawing. `release` gives the renderer back. It is freed
 * `freeAfter` ms after its last user releases it, unless another user comes.
 */
export const sharedRenderer = async ({
  key,
  device,
  trackTimestamp = false,
  setup,
  check,
  freeAfter,
}: SharedRendererOptions) => {
  let entry = pool.get(key);
  if (entry && entry.device !== device) entry = undefined;
  if (!entry) {
    const renderer = new THREE.WebGPURenderer({
      antialias: true,
      canvas: noCanvas(),
      device,
      trackTimestamp,
    } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
    withoutWebGLFallback(renderer);
    setup(renderer);
    const made: Pooled = {
      renderer,
      device,
      users: 0,
      freeing: null,
      ready: renderer.init().then(() => check(renderer)),
    };
    entry = made;
    pool.set(key, made);
    // A renderer that failed to start is dropped, so the next scene creates a new one.
    made.ready.catch(() => {
      if (pool.get(key) === made) pool.delete(key);
    });
  }
  const used = entry;
  used.users++;
  if (used.freeing) {
    clearTimeout(used.freeing);
    used.freeing = null;
  }
  let given = false;
  const release = () => {
    if (given) return;
    given = true;
    used.users--;
    if (used.users > 0) return;
    used.freeing = setTimeout(() => {
      used.freeing = null;
      if (used.users > 0) return;
      if (pool.get(key) === used) pool.delete(key);
      disposeRenderer(used.renderer);
    }, freeAfter);
  };
  try {
    const textureCompare = await used.ready;
    return { renderer: used.renderer, textureCompare, release };
  } catch (error) {
    release();
    throw error;
  }
};

/** The number of shared renderers, for diagnostics and tests. */
export const sharedRendererCount = () => pool.size;

/** Stops and frees a renderer. */
export const disposeRenderer = (renderer: Pick<THREE.WebGPURenderer, "setAnimationLoop" | "dispose">) => {
  renderer.setAnimationLoop(null);
  renderer.dispose();
};

/** The part of a GPU device that reports errors (react-native-webgpu and browsers have it). */
interface ErrorReportingDevice {
  addEventListener?: (
    type: "uncapturederror",
    listener: (event: { error?: { message?: string } }) => void,
  ) => void;
}

/**
 * Calls `report` with each GPU error raised by the renderer's device, such
 * as a shader or pipeline the GPU rejects, which otherwise just draws
 * nothing. three listens through `device.onuncapturederror`, which
 * react-native-webgpu never calls. Returns false when the device cannot
 * report errors.
 */
export const watchGpuErrors = (renderer: unknown, report: (message: string) => void) => {
  const device = (renderer as { backend?: { device?: ErrorReportingDevice } }).backend?.device;
  if (typeof device?.addEventListener !== "function") return false;
  device.addEventListener("uncapturederror", (event) => report(event.error?.message || "Unknown GPU error"));
  return true;
};

/** The part of a GPU device that can test whether it accepts a sampler. */
interface ScopedDevice {
  createSampler?: (descriptor: GPUSamplerDescriptor) => unknown;
  pushErrorScope?: (filter: "validation") => void;
  popErrorScope?: () => Promise<unknown>;
}

/**
 * Tells three when the device cannot compare depth while sampling. Dawn
 * disables comparison samplers on some Metal GPUs, including the iOS
 * simulator. three then reads shadow maps without them; otherwise every
 * shadowed draw is rejected and the screen stays empty. three detects this
 * by itself only on Android. Call after `renderer.init()`. Returns whether
 * comparison samplers work.
 */
export const checkTextureCompare = async (renderer: unknown) => {
  const backend = (
    renderer as { backend?: { device?: ScopedDevice; _compatibility?: Record<string, boolean> } }
  ).backend;
  const device = backend?.device;
  const compatibility = backend?._compatibility;
  if (!device?.createSampler || !device.pushErrorScope || !device.popErrorScope || !compatibility)
    return true;
  if (compatibility[THREE.Compatibility.TEXTURE_COMPARE] === false) return false;
  let works = true;
  try {
    device.pushErrorScope("validation");
    device.createSampler({ compare: "less-equal" });
    works = !(await device.popErrorScope());
  } catch {
    // The device cannot tell, so three's own setting stays.
  }
  if (!works) compatibility[THREE.Compatibility.TEXTURE_COMPARE] = false;
  return works;
};
