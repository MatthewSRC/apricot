import * as THREE from "three/webgpu";
import type { Environment } from "../environment";
import { LOOKS, type Look } from "../look";
import type { FrameLoopMode, FrameScheduler } from "../loop";
import type { OcclusionOptions } from "../occlusion";
import type { CreateRendererOptions } from "../renderer";
import type { ShadowOptions } from "../shadows";

/**
 * The part of react-native-webgpu's RNCanvasContext the scene needs, or a
 * WebGL 2 context for a browser without WebGPU.
 */
export type CanvasContext = (GPUCanvasContext & { present?: () => void }) | WebGL2RenderingContext;

export interface CameraOptions {
  /** Camera position (default [0, 0, 6]). */
  position?: readonly [number, number, number];
  /** Point the camera looks at (default the origin). */
  target?: readonly [number, number, number];
  /** Vertical field of view in degrees (default 50). */
  fov?: number;
  /** Nearest distance drawn (default 0.1). */
  near?: number;
  /** Farthest distance drawn (default 200). Raise it for big scenes. */
  far?: number;
}

export type ToneMappingName = "agx" | "neutral" | "filmic" | "none";

const TONE_MAPPINGS: Record<ToneMappingName, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  filmic: THREE.ACESFilmicToneMapping,
  none: THREE.NoToneMapping,
};

/** The renderer methods the scene uses. Tests can supply their own. */
export type SceneRenderer = Pick<
  THREE.WebGPURenderer,
  "init" | "render" | "setSize" | "setPixelRatio" | "setClearColor" | "setAnimationLoop" | "dispose"
> & {
  toneMapping: THREE.ToneMapping;
  toneMappingExposure?: number;
  /** three's shadow map settings. Test doubles may omit it. */
  shadowMap?: { enabled: boolean; type?: THREE.ShadowMapType };
  /** GPU time in ms of the frames drawn since the last call, when timestamps are tracked. */
  resolveTimestampsAsync?: (type?: "render" | "compute") => Promise<number | undefined>;
  /** Compiles shaders without drawing. Test doubles may omit it. */
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene) => Promise<void>;
};

export interface SceneOptions {
  /** "demand" (default) draws only after a change; "always" draws every display frame. */
  frameloop?: FrameLoopMode;
  /** Lighting preset (default "soft"). "none" adds no lights. */
  look?: Look | "none";
  /** Clears to transparent so the views behind the canvas show through. */
  transparent?: boolean;
  /** Background colour. Overrides the look's. */
  background?: THREE.ColorRepresentation;
  /**
   * How scene light is mapped to screen colours. Overrides the look's, which
   * is "agx" for "soft" and "studio". "agx" has soft highlights, "neutral"
   * keeps colours closer to their values, "filmic" has more contrast, and
   * "none" applies no mapping.
   */
  toneMapping?: ToneMappingName;
  /** Multiplies the brightness of the whole picture (default 1). */
  exposure?: number;
  camera?: CameraOptions;
  /**
   * Fades distant objects into the background colour, which hides the edge
   * of a large ground. `true` fades from 30 to 90 units.
   */
  fog?: boolean | { near?: number; far?: number; color?: THREE.ColorRepresentation };
  /**
   * Light reflected by metals and glossy materials: a named environment
   * ("studio", "soft", "sunset", "night", or one from defineEnvironment),
   * custom StudioOptions, or "none" (default). It is procedural, so no
   * environment map is generated.
   */
  environment?: Environment;
  /** Upper limit on the device pixel ratio used for the drawing buffer (default 2). */
  maxPixelRatio?: number;
  /** In "demand" mode, seconds to keep drawing after the last change (default 0.25). */
  linger?: number;
  /**
   * Compiles shaders for everything in the scene in the background,
   * including objects the camera cannot see yet, so objects do not stutter
   * the first time they come into view (default true).
   */
  warmUp?: boolean;
  /**
   * Shadows from the main directional light: the look's key light, the sun,
   * or a light marked to cast with setShadow. Pass `true` or ShadowOptions.
   * All meshes cast and receive, except flat ones, which only receive, and
   * see-through ones. The shadow map is redrawn only when a caster moves.
   */
  shadows?: boolean | ShadowOptions;
  /**
   * Ambient occlusion: soft darkening where surfaces meet or come close, such
   * as room corners or the floor under a sofa. Pass `true` or
   * OcclusionOptions. Costs an extra output and a half-resolution pass per
   * frame.
   */
  occlusion?: boolean | OcclusionOptions;
  /**
   * How many lamps (<Lamp>) can light the scene at once (default 0, so lamps
   * only glow). The lights are created up front and stay dark until a lamp
   * uses them, so lamps can come and go without rebuilding shaders. Beyond
   * this number the brightest lamps win. Each light adds a little cost to
   * everything lit.
   */
  lamps?: number;
  /**
   * "standard" (default) uses three's usual lighting. "dynamic" passes lights
   * to shaders as arrays, so lights can come and go without rebuilding
   * shaders and each costs only while it is on. `lamps` can then be large.
   */
  lighting?: "standard" | "dynamic";
  /**
   * Measures GPU time per frame where the device supports it, for the
   * diagnostics report and <Scene debug>. Adds a small cost.
   */
  gpuTiming?: boolean;
  /**
   * Draws on the GPU device shared by all scenes (default true), so a scene
   * starts without waiting for a new device and is removed without
   * destroying one, which stalls the screen. When false, the scene requests
   * its own device.
   */
  shareDevice?: boolean;
  /** Schedules frames (default requestAnimationFrame). For tests. */
  scheduler?: FrameScheduler;
  /** Creates the scene's own renderer instead of using a shared one. For tests. */
  createRenderer?: (options: CreateRendererOptions) => SceneRenderer;
}

export interface AttachOptions {
  /** Layout width in points. */
  width: number;
  /** Layout height in points. */
  height: number;
  devicePixelRatio: number;
  /** Draws on this GPU device instead of the shared one. */
  device?: GPUDevice;
}

/** A layout size in points with its device pixel ratio. */
export type LayoutSize = Omit<AttachOptions, "device">;

/** The tone mapping a scene draws with: the `toneMapping` option, or else its look's. */
export const toneMappingFor = ({ toneMapping, look = "soft" }: SceneOptions) => {
  if (toneMapping) return TONE_MAPPINGS[toneMapping];
  return look === "none" ? THREE.AgXToneMapping : LOOKS[look].toneMapping;
};
