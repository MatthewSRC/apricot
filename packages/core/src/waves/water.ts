import {
  dot,
  float,
  mix,
  modelWorldMatrix,
  mx_noise_float,
  normalize,
  normalView,
  positionGeometry,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  texture,
  time,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { ShoreField } from "./shore";
import type { Waves } from "./trains";

export interface WaterOptions {
  /** The waves that move the surface (default: still water). */
  waves?: Waves;
  /**
   * Distance to the shore, from createShoreField. With it, the water is
   * `shoreline` at the land, `shallow` over the shallows and `deep` out at
   * sea, with foam along the shore and caustics in the shallows. Without
   * it, the colour goes from `shallow` seen from above to `deep` at a slant.
   */
  shore?: ShoreField;
  /** Colour over the shallows, or seen from straight above without a shore (default bright turquoise). */
  shallow?: THREE.ColorRepresentation;
  /** Colour out at sea, or seen at a slant without a shore (default azure). */
  deep?: THREE.ColorRepresentation;
  /** Colour where the water meets the land, when a shore is given (default pale aqua). */
  shoreline?: THREE.ColorRepresentation;
  /** Colour of the foam along the shore, or false for none (default white). */
  foam?: THREE.ColorRepresentation | false;
  /** Strength of the caustics in the shallows, 0 to 1 (default 0.6). Needs a shore. */
  caustics?: number;
  /** Emissive strength of the water's own colour, which keeps it vivid in any light (default 0.35). */
  glow?: number;
  /** Transparency from 0 (opaque, default) to 1. */
  clarity?: number;
  /** Strength of the pale highlight on wave crests, 0 to 1 (default 0.5). */
  sparkle?: number;
  /**
   * Size of the shore details when a shore is given (default 1). The foam
   * line (about 13 cm wide at 1), the breaking foam and the caustics scale
   * with it. 1 suits a pool or small beach seen close up; a lake or coast
   * seen from afar needs 5 or more. Changing it requires a new material.
   */
  scale?: number;
}

/** A water material and a function to update its live settings. */
export interface WaterMaterial {
  material: THREE.MeshStandardNodeMaterial;
  set: (
    options: Omit<WaterOptions, "waves" | "shore" | "foam" | "scale"> & { foam?: THREE.ColorRepresentation },
  ) => void;
}

/**
 * A material for a flat water mesh lying in its own x-z plane, untilted
 * (see createWaterGeometry). `waves` displace and tilt the surface, and
 * `shore` adds shore colours, foam and caustics. The colours and strengths
 * can be changed later with `set` without rebuilding the shader.
 */
export const createWaterMaterial = ({
  waves,
  shore,
  shallow = "#3fe0d3",
  deep = "#0a7fd6",
  shoreline = "#b9f3e6",
  foam = "#ffffff",
  caustics = 0.6,
  glow = 0.35,
  clarity = 0,
  sparkle = 0.5,
  scale = 1,
}: WaterOptions = {}): WaterMaterial => {
  const near = uniform(new THREE.Color(shallow));
  const far = uniform(new THREE.Color(deep));
  const edge = uniform(new THREE.Color(shoreline));
  const froth = uniform(new THREE.Color(foam === false ? "#ffffff" : foam));
  const dancing = uniform(caustics);
  const shine = uniform(glow);
  const clear = uniform(clarity);
  const glint = uniform(sparkle);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.16, metalness: 0 });
  const world = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;
  const clock = waves ? waves.time : time;
  const facing = dot(normalView, positionViewDirection).clamp(0, 1);
  let body: THREE.Node<"vec3">;
  if (shore) {
    const [minX, minZ, maxX, maxZ] = shore.bounds;
    const uv = vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
    // 0 on the shore, 1 out at sea and outside the field.
    const out = texture(shore.texture, uv).r;
    // Shore detail distances and positions, in units of `scale` metres.
    const metres = out.mul(shore.reach / scale);
    const at = world.div(scale);
    const shelf = smoothstep(float(0), float(0.16), out);
    const sea = smoothstep(float(0.12), float(1), out);
    const water = mix(mix(edge, near, shelf), far, sea);
    // Caustics: thin bright ridges of slowly moving noise.
    const ridge = (size: number, speed: number) =>
      pow(
        float(1).sub(mx_noise_float(vec3(at.x.mul(size), at.z.mul(size), clock.mul(speed))).abs()),
        float(9),
      );
    const dance = ridge(2.4, 0.45)
      .add(ridge(4.1, -0.6).mul(0.6))
      .mul(float(1).sub(sea))
      .mul(dancing)
      .mul(0.55);
    // Foam: a line at the water's edge, plus a broken line further out that fades in and out.
    const lap = metres.add(sin(clock.mul(1.3).add(at.x.mul(0.7)).add(at.z.mul(0.5))).mul(0.04));
    const line = float(1).sub(smoothstep(float(0.03), float(0.13), lap));
    const breaking = smoothstep(
      float(0.05),
      float(0),
      lap.sub(float(0.32).add(sin(clock.mul(0.9)).mul(0.08))).abs(),
    ).mul(
      smoothstep(
        float(0.45),
        float(0.7),
        mx_noise_float(vec3(at.x.mul(3), at.z.mul(3), clock.mul(0.3)))
          .mul(0.5)
          .add(0.5),
      ),
    );
    const foamy = foam === false ? float(0) : line.add(breaking.mul(0.7)).clamp(0, 1);
    body = mix(water.add(dance), froth, foamy);
  } else {
    // Shallow colour when seen from straight above, deep at a slant.
    body = mix(far, near, pow(facing, float(0.7)));
  }
  if (waves) {
    const { height, sx, sz } = waves.nodes(world);
    material.positionNode = positionGeometry.add(vec3(0, height, 0));
    material.normalNode = transformNormalToView(normalize(vec3(sx.negate(), 1, sz.negate())));
    // Highlight the highest crests.
    const crest = smoothstep(float(0.7), float(1), height.div(waves.peak));
    body = body.add(crest.mul(glint).mul(0.35));
  }
  material.colorNode = body;
  // Emit the body colour so the water stays vivid in any light. Lighting adds highlights on top.
  material.emissiveNode = body.mul(shine);
  material.opacityNode = float(1).sub(clear.mul(facing).mul(0.75));
  material.transparent = clarity > 0;
  material.depthWrite = clarity === 0;
  return {
    material,
    set: (options) => {
      if (options.shallow !== undefined) near.value.set(options.shallow);
      if (options.deep !== undefined) far.value.set(options.deep);
      if (options.shoreline !== undefined) edge.value.set(options.shoreline);
      if (options.foam !== undefined) froth.value.set(options.foam);
      if (options.caustics !== undefined) dancing.value = options.caustics;
      if (options.glow !== undefined) shine.value = options.glow;
      if (options.clarity !== undefined) clear.value = options.clarity;
      if (options.sparkle !== undefined) glint.value = options.sparkle;
    },
  };
};

/** A flat sheet `width` × `depth` metres in the x-z plane, subdivided about every `spacing` metres (at most 160 per side) for waves. */
export const createWaterGeometry = (width: number, depth: number, spacing = 0.25) => {
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    Math.max(1, Math.min(160, Math.round(width / spacing))),
    Math.max(1, Math.min(160, Math.round(depth / spacing))),
  );
  geometry.rotateX(-Math.PI / 2);
  return geometry;
};
