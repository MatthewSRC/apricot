import {
  float,
  max,
  mix,
  mx_noise_float,
  positionLocal,
  pow,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

type ColorNode = THREE.Node<"vec4">;

/**
 * What a preset is made of. Colour, roughness and metalness become live
 * values (set or animate them without rebuilding the shader); the rest is
 * fixed when the material is created.
 */
export interface PresetSpec {
  color: THREE.ColorRepresentation;
  roughness: number;
  metalness: number;
  /** Clear lacquer on top (car paint, piano black). */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Directional highlights and fine streaks along the surface's U direction (brushed metal). */
  brushed?: boolean;
  /** Metallic flakes under the lacquer (car paint). */
  flakes?: boolean;
  /** See-through: 1 = clear glass. Needs something behind it to look like anything. */
  transmission?: number;
  ior?: number;
  thickness?: number;
  /** Colour picked up through the glass, and how fast (smaller = darker tint). */
  attenuationColor?: THREE.ColorRepresentation;
  attenuationDistance?: number;
  /** Glows by itself (lamps, screens), in this colour or, with "color", in the material's own (live) colour. */
  emissive?: THREE.ColorRepresentation | "color";
  emissiveIntensity?: number;
}

/** Engraving (or etching, printing) from a mask image: opaque = engraved. */
export interface Engraving {
  mask: THREE.Texture;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** Where to read the mask (default: the mesh's UVs). */
  uv?: THREE.Node<"vec2">;
  /** Multiplies the mask, for example to engrave one side only. */
  weight?: THREE.Node<"float">;
}

export interface MaterialOptions {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** A colour image; multiplies `color`. */
  map?: THREE.Texture | null;
  /** Texture coordinates for the image, brushed streaks and engraving (default: the mesh's UVs). */
  uv?: THREE.Node<"vec2">;
  engrave?: Engraving | null;
  /** Which faces show: "front" (default), "back", or "double" for thin things seen from both sides. */
  side?: "front" | "back" | "double";
  /** Multiplies the colour by the shape's own per-vertex colours (default false). */
  vertexColors?: boolean;
  /** Any other physical-material property, for full control. */
  physical?: Partial<THREE.MeshPhysicalNodeMaterialParameters>;
}

const presets = new Map<string, PresetSpec>();

/** Registers a material preset under `name`, usable anywhere a preset name is accepted. Replaces an existing one. */
export const definePreset = (name: string, spec: PresetSpec) => {
  presets.set(name, spec);
};

/** The registered preset names. */
export const presetNames = () => [...presets.keys()];

/** A registered preset's spec; throws for unknown names, listing the known ones. */
export const getPreset = (name: string): PresetSpec => {
  const spec = presets.get(name);
  if (!spec) throw new Error(`Unknown material preset "${name}". Known: ${presetNames().join(", ")}`);
  return spec;
};

// Built-in presets, tuned under the studio environment.
const BUILT_IN: Record<string, PresetSpec> = {
  // What shapes wear unless told otherwise: a light, slightly glossy grey.
  standard: { color: "#cfd3d8", roughness: 0.5, metalness: 0 },
  "car-paint": {
    color: "#a8102a",
    roughness: 0.32,
    metalness: 0.55,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    flakes: true,
  },
  paint: { color: "#1d3f8f", roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 },
  "gloss-black": { color: "#0b0c0e", roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 },
  chrome: { color: "#eceef1", roughness: 0.04, metalness: 1 },
  "brushed-metal": { color: "#c9cdd3", roughness: 0.3, metalness: 1, brushed: true },
  aluminium: { color: "#d5d8dc", roughness: 0.2, metalness: 1 },
  gold: { color: "#e9bd63", roughness: 0.18, metalness: 1 },
  "rose-gold": { color: "#eab09a", roughness: 0.2, metalness: 1 },
  glass: { color: "#f4f8fb", roughness: 0.04, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.05 },
  "tinted-glass": {
    color: "#ffffff",
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: 0.05,
    attenuationColor: "#20262c",
    attenuationDistance: 0.02,
  },
  rubber: { color: "#1c1d1f", roughness: 0.9, metalness: 0 },
  plastic: { color: "#2a2c30", roughness: 0.5, metalness: 0 },
  matte: { color: "#2b2d32", roughness: 0.7, metalness: 0 },
  clay: { color: "#d9d4cc", roughness: 0.9, metalness: 0 },
  light: { color: "#ffffff", roughness: 0.3, metalness: 0, emissive: "color", emissiveIntensity: 2 },
};
for (const [name, spec] of Object.entries(BUILT_IN)) definePreset(name, spec);

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;

interface Live {
  color: THREE.Color;
  roughness: number;
  metalness: number;
}

/**
 * The straight colour of a premultiplied image, divided out after filtering
 * (filtering premultiplied colours keeps edges clean). sRGB images were
 * premultiplied before decoding to linear, which scales by about alpha^2.2.
 */
const unpremultiply = (sample: THREE.Node<"vec4">, image: THREE.Texture) => {
  const a = max(sample.a, float(1 / 255));
  return sample.rgb.div(image.colorSpace === THREE.SRGBColorSpace ? pow(a, float(2.2)) : a);
};

/**
 * A material made from a preset. Colour, roughness and metalness can change
 * at any time, instantly (set) or over time (animateTo + step), without
 * rebuilding the shader. Other options (images, engraving) are fixed:
 * create a new one to change them.
 */
export class PresetMaterial {
  readonly material: THREE.MeshPhysicalNodeMaterial;
  readonly preset: string;
  private readonly color = uniform(new THREE.Color());
  private readonly roughness = uniform(0);
  private readonly metalness = uniform(0);
  private animation: { from: Live; to: Live; elapsed: number; duration: number } | null = null;

  constructor(preset: string, options: MaterialOptions = {}) {
    const spec = getPreset(preset);
    this.preset = preset;
    this.color.value.set(options.color ?? spec.color);
    this.roughness.value = options.roughness ?? spec.roughness;
    this.metalness.value = options.metalness ?? spec.metalness;

    const material = new THREE.MeshPhysicalNodeMaterial({ name: preset });
    let color = this.color as unknown as THREE.Node<"vec3">;
    let roughness: THREE.Node<"float"> = this.roughness;
    let metalness: THREE.Node<"float"> = this.metalness;
    const coordinates = options.uv ?? uv();
    // The image's alpha cuts the material out (alphaTest) or fades it (transparent), as in three.js.
    let alpha: THREE.Node<"float"> | null = null;
    if (options.map) {
      const sample = texture(options.map, coordinates);
      alpha = sample.a;
      color = color.mul(options.map.premultiplyAlpha ? unpremultiply(sample, options.map) : sample.rgb);
    }
    if (spec.brushed) {
      // Streaks along U: noise stretched hundreds of times across V.
      const streak = mx_noise_float(vec2(coordinates.x.mul(6), coordinates.y.mul(900)));
      color = color.mul(streak.mul(0.06).add(1));
      roughness = roughness.add(streak.mul(0.08));
      material.anisotropy = 0.75;
    }
    if (spec.flakes) {
      // Fine sparkle under the lacquer.
      roughness = roughness.add(mx_noise_float(positionLocal.mul(500)).mul(0.1));
    }
    const engrave = options.engrave;
    if (engrave) {
      const sampled = texture(engrave.mask, engrave.uv ?? coordinates).a;
      const mask = engrave.weight ? sampled.mul(engrave.weight) : sampled;
      color = mix(color, uniformColor(engrave.color ?? spec.color), mask);
      roughness = mix(roughness, float(engrave.roughness ?? Math.min(1, spec.roughness + 0.3)), mask);
      metalness = mix(metalness, float(engrave.metalness ?? spec.metalness), mask);
      if (spec.transmission) material.transmissionNode = float(spec.transmission).sub(mask.mul(0.7));
    }
    material.colorNode = (alpha ? vec4(color, alpha) : color) as unknown as ColorNode;
    material.roughnessNode = roughness;
    material.metalnessNode = metalness;
    if (spec.clearcoat) {
      material.clearcoat = spec.clearcoat;
      material.clearcoatRoughness = spec.clearcoatRoughness ?? 0.05;
    }
    if (spec.transmission) {
      material.transmission = spec.transmission;
      material.ior = spec.ior ?? 1.5;
      material.thickness = spec.thickness ?? 0.05;
      if (spec.attenuationColor) material.attenuationColor = new THREE.Color(spec.attenuationColor);
      if (spec.attenuationDistance) material.attenuationDistance = spec.attenuationDistance;
    }
    if (spec.emissive === "color") {
      // Follows colour changes, like the base colour.
      material.emissiveNode = (this.color as unknown as THREE.Node<"vec3">).mul(spec.emissiveIntensity ?? 1);
      material.emissiveIntensity = spec.emissiveIntensity ?? 1;
    } else if (spec.emissive) {
      material.emissive = new THREE.Color(spec.emissive);
      material.emissiveIntensity = spec.emissiveIntensity ?? 1;
    }
    if (options.side) material.side = SIDES[options.side];
    if (options.vertexColors) material.vertexColors = true;
    if (options.physical) material.setValues(options.physical);
    this.material = material;
    this.mirror();
  }

  // Keeps the material's plain properties equal to the live values, for code that inspects them.
  private mirror() {
    this.material.color.copy(this.color.value);
    this.material.roughness = this.roughness.value;
    this.material.metalness = this.metalness.value;
  }

  /** The current live values. */
  get values(): Readonly<Live> {
    return {
      color: this.color.value.clone(),
      roughness: this.roughness.value,
      metalness: this.metalness.value,
    };
  }

  /** Changes colour, roughness or metalness right away. */
  set({ color, roughness, metalness }: Pick<MaterialOptions, "color" | "roughness" | "metalness">) {
    this.animation = null;
    if (color !== undefined) this.color.value.set(color);
    if (roughness !== undefined) this.roughness.value = roughness;
    if (metalness !== undefined) this.metalness.value = metalness;
    this.mirror();
  }

  /** Starts a smooth change over `seconds`; drive it with step(). */
  animateTo(target: Pick<MaterialOptions, "color" | "roughness" | "metalness">, seconds = 0.4) {
    const from = this.values;
    const to: Live = {
      color: target.color !== undefined ? new THREE.Color(target.color) : from.color.clone(),
      roughness: target.roughness ?? from.roughness,
      metalness: target.metalness ?? from.metalness,
    };
    const same =
      to.color.equals(from.color) && to.roughness === from.roughness && to.metalness === from.metalness;
    if (same) return;
    if (seconds <= 0) {
      this.set(target);
      return;
    }
    this.animation = { from, to, elapsed: 0, duration: seconds };
  }

  /** Advances an animateTo(); returns true while still changing. */
  step(delta: number) {
    const a = this.animation;
    if (!a) return false;
    a.elapsed = Math.min(a.duration, a.elapsed + delta);
    const t = a.elapsed / a.duration;
    const ease = t * t * (3 - 2 * t);
    if (t >= 1) {
      // Ends exactly on the target, which interpolation can miss by a rounding error.
      this.color.value.copy(a.to.color);
      this.roughness.value = a.to.roughness;
      this.metalness.value = a.to.metalness;
      this.animation = null;
    } else {
      this.color.value.copy(a.from.color).lerp(a.to.color, ease);
      this.roughness.value = a.from.roughness + (a.to.roughness - a.from.roughness) * ease;
      this.metalness.value = a.from.metalness + (a.to.metalness - a.from.metalness) * ease;
    }
    this.mirror();
    return this.animation !== null;
  }

  dispose() {
    this.material.dispose();
  }
}

const uniformColor = (value: THREE.ColorRepresentation) =>
  uniform(new THREE.Color(value)) as unknown as THREE.Node<"vec3">;

/** A material from a preset, for when you do not need to change it later. */
export const createMaterial = (preset: string, options?: MaterialOptions) =>
  new PresetMaterial(preset, options).material;
