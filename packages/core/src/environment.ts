import { abs, cos, dot, float, max, mix, normalWorld, sin, smoothstep, uniform, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

// A procedural environment for metals and glossy materials. Instead of an
// environment map, which is slow to generate with PMREMGenerator, it is a
// function that returns the light arriving from a direction at a given
// roughness. It models a photo studio: a gradient from a bright ceiling to a
// dark floor, plus a few soft boxes whose edges widen with roughness. three's
// PBR materials sample it like any environment (scene.environmentNode), for
// reflections and ambient light.

type V3 = readonly [number, number, number];

export interface SoftBox {
  /** Direction from the object towards the box, world space. */
  direction: V3;
  /** Half width and half height, in radians. */
  size: readonly [number, number];
  /** Brightness (above 1 for highlights). */
  intensity: number;
  color?: THREE.ColorRepresentation;
}

export interface StudioOptions {
  /** Colours of the ceiling, horizon and floor. */
  sky?: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation];
  boxes?: readonly SoftBox[];
  /** Overall brightness (default 1). */
  intensity?: number;
}

/**
 * The default studio: a key box above and in front, tall strips on both
 * sides, a soft top light, a faint rim behind, and a dim fill from the
 * camera side. "In front" is +z, towards the default camera, so objects
 * facing the camera catch the highlights.
 */
export const STUDIO: Required<StudioOptions> = {
  sky: ["#4a4f58", "#25282e", "#0b0c0e"],
  boxes: [
    { direction: [0.35, 0.55, 0.75], size: [0.24, 0.12], intensity: 6, color: "#fff6ea" },
    { direction: [-0.85, 0.12, 0.5], size: [0.07, 0.65], intensity: 5, color: "#eef3ff" },
    { direction: [0.88, 0.05, 0.45], size: [0.05, 0.6], intensity: 3.5, color: "#ffffff" },
    { direction: [0, 1, 0.12], size: [0.45, 0.2], intensity: 1, color: "#ffffff" },
    { direction: [0, 0.25, -1], size: [0.7, 0.25], intensity: 1.2, color: "#dfe7ff" },
    // A large, dim diffuser behind the camera, so surfaces facing the viewer keep a soft sheen.
    { direction: [-0.1, 0.05, 1], size: [0.55, 0.4], intensity: 0.9, color: "#e9eef7" },
  ],
  intensity: 1,
};

// Soft box slots. The boxes are uniforms, so moving them, rotating the studio
// or fading to another environment never rebuilds a shader. Only a studio
// with more boxes than slots needs a new node.
const SLOTS = 6;

interface BoxUniforms {
  forward: THREE.UniformNode<"vec3", THREE.Vector3>;
  right: THREE.UniformNode<"vec3", THREE.Vector3>;
  up: THREE.UniformNode<"vec3", THREE.Vector3>;
  size: THREE.UniformNode<"vec2", THREE.Vector2>;
  intensity: THREE.UniformNode<"float", number>;
  color: THREE.UniformNode<"color", THREE.Color>;
}

/** A studio's state as numbers, for blending between studios. */
interface StudioState {
  sky: [THREE.Color, THREE.Color, THREE.Color];
  boxes: { direction: THREE.Vector3; size: THREE.Vector2; intensity: number; color: THREE.Color }[];
  intensity: number;
}

const stateOf = (options: StudioOptions, slots: number): StudioState => {
  const { sky, boxes, intensity } = { ...STUDIO, ...options };
  return {
    sky: [new THREE.Color(sky[0]), new THREE.Color(sky[1]), new THREE.Color(sky[2])],
    boxes: Array.from({ length: slots }, (_, i) => {
      const box = boxes[i];
      return box
        ? {
            direction: new THREE.Vector3(...box.direction).normalize(),
            size: new THREE.Vector2(...box.size),
            intensity: box.intensity,
            color: new THREE.Color(box.color ?? "#ffffff"),
          }
        : // An empty slot is dark and points up, so a box blended in fades in from above.
          {
            direction: new THREE.Vector3(0, 1, 0),
            size: new THREE.Vector2(0.2, 0.2),
            intensity: 0,
            color: new THREE.Color("#ffffff"),
          };
    }),
    intensity,
  };
};

const blend = (a: StudioState, b: StudioState, t: number): StudioState => ({
  sky: a.sky.map((c, i) => c.clone().lerp(b.sky[i], t)) as StudioState["sky"],
  boxes: a.boxes.map((box, i) => ({
    direction: box.direction.clone().lerp(b.boxes[i].direction, t).normalize(),
    size: box.size.clone().lerp(b.boxes[i].size, t),
    intensity: box.intensity + (b.boxes[i].intensity - box.intensity) * t,
    color: box.color.clone().lerp(b.boxes[i].color, t),
  })),
  intensity: a.intensity + (b.intensity - a.intensity) * t,
});

/**
 * The studio's uniforms: sky colours, soft boxes, overall brightness and a
 * rotation around the vertical axis. Shared by every material that reflects it.
 */
export class StudioLight {
  readonly slots: number;
  readonly sky = [
    uniform(new THREE.Color()),
    uniform(new THREE.Color()),
    uniform(new THREE.Color()),
  ] as const;
  readonly intensity = uniform(1);
  /** Multiplies the brightness on top of the studio's own intensity, for dimmers or day and night. */
  readonly gain = uniform(1);
  /** Turns the whole studio around the vertical axis (radians). */
  readonly rotation = uniform(0);
  readonly boxes: BoxUniforms[];
  private state: StudioState;
  private fade: { from: StudioState; to: StudioState; elapsed: number; duration: number } | null = null;

  constructor(options: StudioOptions = {}, slots = Math.max(SLOTS, options.boxes?.length ?? 0)) {
    this.slots = slots;
    this.boxes = Array.from({ length: slots }, () => ({
      forward: uniform(new THREE.Vector3(0, 1, 0)),
      right: uniform(new THREE.Vector3(1, 0, 0)),
      up: uniform(new THREE.Vector3(0, 0, 1)),
      size: uniform(new THREE.Vector2(0.2, 0.2)),
      intensity: uniform(0),
      color: uniform(new THREE.Color()),
    }));
    this.state = stateOf(options, slots);
    this.write(this.state);
  }

  /** Whether `options` fits these slots. Otherwise a new StudioLight is needed. */
  fits(options: StudioOptions) {
    return (options.boxes ?? STUDIO.boxes).length <= this.slots;
  }

  /** Changes to `options` at once, or fades there over `seconds` (drive the fade with step()). */
  set(options: StudioOptions, seconds = 0) {
    const to = stateOf(options, this.slots);
    if (seconds <= 0) {
      this.fade = null;
      this.state = to;
      this.write(to);
    } else {
      this.fade = { from: this.state, to, elapsed: 0, duration: seconds };
    }
  }

  /** Advances a fade; returns true while still changing. */
  step(delta: number) {
    const f = this.fade;
    if (!f) return false;
    f.elapsed = Math.min(f.duration, f.elapsed + delta);
    const t = f.elapsed / f.duration;
    this.state = t >= 1 ? f.to : blend(f.from, f.to, t * t * (3 - 2 * t));
    if (t >= 1) this.fade = null;
    this.write(this.state);
    return this.fade !== null;
  }

  private write(state: StudioState) {
    for (const [i, c] of state.sky.entries()) this.sky[i].value.copy(c);
    this.intensity.value = state.intensity;
    state.boxes.forEach((box, i) => {
      const u = this.boxes[i];
      const { forward, right, up } = frameOf(box.direction);
      u.forward.value.copy(forward);
      u.right.value.copy(right);
      u.up.value.copy(up);
      u.size.value.copy(box.size);
      u.intensity.value = box.intensity;
      u.color.value.copy(box.color);
    });
  }
}

const frameOf = (direction: THREE.Vector3) => {
  const forward = direction.clone().normalize();
  const helper = Math.abs(forward.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(helper, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  return { forward, right, up };
};

/** The studio's light along `direction` (world space, normalised) at `roughness` (0–1). */
export const studioRadiance = (
  direction: THREE.Node<"vec3">,
  roughness: THREE.Node<"float">,
  studio: StudioLight | StudioOptions = {},
) => {
  const light = studio instanceof StudioLight ? studio : new StudioLight(studio);
  // Rotates the lookup direction instead of the studio.
  const c = cos(light.rotation);
  const s = sin(light.rotation);
  const d = vec3(
    c.mul(direction.x).sub(s.mul(direction.z)),
    direction.y,
    s.mul(direction.x).add(c.mul(direction.z)),
  );
  const up = d.y;
  const [ceiling, horizon, floor] = light.sky as unknown as THREE.Node<"vec3">[];
  const upper = mix(horizon, ceiling, smoothstep(-0.05, 0.9, up));
  let result: THREE.Node<"vec3"> = mix(floor, upper, smoothstep(-0.4, 0.05, up));

  // Rough surfaces see a wider, dimmer box with about the same total light.
  const spread = roughness.mul(roughness).mul(0.9).add(roughness.mul(0.15));
  const edge = roughness.mul(0.35).add(0.012);
  const blur = roughness.mul(roughness).mul(2).add(1);
  for (const box of light.boxes) {
    const width = box.size.x.add(spread);
    const height = box.size.y.add(spread);
    const x = abs(dot(d, box.right));
    const y = abs(dot(d, box.up));
    const facing = smoothstep(0, 0.2, dot(d, box.forward));
    // Brightest in the middle, like a real diffuser, so flat mirrors show a gradient.
    const falloff = float(1).sub(x.div(width).mul(x.div(width)).mul(0.6));
    const mask = smoothstep(width.add(edge), width.sub(edge), x)
      .mul(smoothstep(height.add(edge), height.sub(edge), y))
      .mul(falloff)
      .mul(facing);
    // Spreads the same light over the wider box, minus some lost to the blur.
    const dimming = box.size.x
      .mul(box.size.y)
      .div(max(width.mul(height), 1e-4))
      .div(blur);
    result = result.add(
      (box.color as unknown as THREE.Node<"vec3">).mul(mask.mul(dimming).mul(box.intensity)),
    );
  }
  return result.mul(light.intensity).mul(light.gain);
};

/**
 * A procedural studio environment, for `scene.environmentNode`. three asks
 * it for light along reflection directions (with the surface roughness) and
 * along normals (diffuse ambient, roughness 1). Its `light` holds uniforms,
 * so boxes can move and the studio can rotate or fade without rebuilding
 * shaders.
 */
export class StudioEnvironmentNode extends THREE.Node {
  static get type() {
    return "StudioEnvironmentNode";
  }

  readonly options: StudioOptions;
  readonly light: StudioLight;

  constructor(options: StudioOptions = {}) {
    super("vec3");
    this.options = options;
    this.light = new StudioLight(options);
  }

  setup(builder: THREE.NodeBuilder) {
    // EnvironmentNode supplies these through the build context.
    const context = builder.context as {
      getUV?: () => THREE.Node<"vec3">;
      getTextureLevel?: () => THREE.Node<"float">;
    };
    const direction = (context.getUV?.() ?? normalWorld).normalize();
    const roughness = context.getTextureLevel?.() ?? float(1);
    return studioRadiance(direction, roughness, this.light);
  }
}

const environments = new Map<string, StudioOptions>();

/**
 * Registers an environment, a sky gradient and soft boxes, under `name` for
 * use as <Scene environment>. Replaces an existing one.
 *
 *   defineEnvironment("brand", { sky: ["#ffe9d6", "#f3b38a", "#3a2418"], boxes: [...] });
 */
export const defineEnvironment = (name: string, options: StudioOptions) => {
  environments.set(name, options);
};

/** The registered environment names. */
export const environmentNames = () => [...environments.keys()];

/** A registered environment; throws for unknown names, listing the known ones. */
export const getEnvironment = (name: string): StudioOptions => {
  const options = environments.get(name);
  if (!options)
    throw new Error(`Unknown environment "${name}". Known: ${environmentNames().join(", ")}, none`);
  return options;
};

const BUILT_IN: Record<string, StudioOptions> = {
  studio: STUDIO,
  // Light and even: pale products, white phones, soft paint.
  soft: {
    sky: ["#e4e7ec", "#b4b9c1", "#5d6169"],
    boxes: [
      { direction: [0, 1, 0.25], size: [0.9, 0.45], intensity: 2.4, color: "#ffffff" },
      { direction: [-0.6, 0.35, 0.7], size: [0.5, 0.4], intensity: 2, color: "#fffaf2" },
      { direction: [0.8, 0.2, 0.45], size: [0.3, 0.5], intensity: 1.5, color: "#f2f6ff" },
    ],
    intensity: 1,
  },
  // A low warm sun behind and to the side, an orange horizon, a cool sky.
  sunset: {
    sky: ["#3a4a7a", "#e3824a", "#22160f"],
    boxes: [
      { direction: [0.75, 0.1, -0.45], size: [0.09, 0.07], intensity: 14, color: "#ffb36e" },
      { direction: [0, 0.04, 1], size: [1.3, 0.07], intensity: 1.6, color: "#ff9a5a" },
      { direction: [-0.3, 1, 0.2], size: [0.6, 0.4], intensity: 0.6, color: "#8ea4ff" },
    ],
    intensity: 1,
  },
  // Dark, with coloured neon strips on the sides and a thin light above.
  night: {
    sky: ["#0c1124", "#151b33", "#050608"],
    boxes: [
      { direction: [-0.85, 0.1, 0.5], size: [0.04, 0.7], intensity: 6, color: "#3fa7ff" },
      { direction: [0.85, 0.1, 0.5], size: [0.04, 0.7], intensity: 6, color: "#ff4fd8" },
      { direction: [0, 1, 0.1], size: [0.5, 0.04], intensity: 3, color: "#ffffff" },
    ],
    intensity: 1,
  },
};
for (const [name, options] of Object.entries(BUILT_IN)) defineEnvironment(name, options);

/** An environment name ("studio", "soft", "sunset", "night", your own), "none", or a setup. */
export type Environment = string | StudioOptions;

/** Sets (or, with "none", removes) the scene's procedural environment. */
export const applyEnvironment = (scene: THREE.Scene, environment: Environment) => {
  const target = scene as unknown as { environmentNode: THREE.Node | null };
  target.environmentNode =
    environment === "none"
      ? null
      : new StudioEnvironmentNode(
          typeof environment === "string" ? getEnvironment(environment) : environment,
        );
};
