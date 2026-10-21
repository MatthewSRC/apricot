import {
  abs,
  dot,
  float,
  normalView,
  positionGeometry,
  positionViewDirection,
  pow,
  smoothstep,
  uniform,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { Vec3 } from "./spin";

export interface LightBeamOptions {
  /** Colour of the light (default warm sunlight). */
  color?: THREE.ColorRepresentation;
  /** Brightness at the start of the beam (default 1). */
  intensity?: number;
  /** The fraction of the beam's length, 0 to 1, by which the light has faded out (default 1). */
  reach?: number;
}

/** A light beam material and a function to update its settings. */
export interface LightBeamMaterial {
  material: THREE.MeshBasicNodeMaterial;
  /** Updates colour, intensity and reach. These are uniforms, so no shader is rebuilt. */
  set: (options: LightBeamOptions) => void;
}

/**
 * A material for a beam of light through dusty air, such as sun through a
 * window. It blends additively, is brightest near the start and fades along
 * its length and towards its edges, so it reads as a soft volume. It is
 * meant for a box from z = 0 (the start) to z = 1 in local space (see
 * createLightBeamGeometry). It neither casts nor receives shadows.
 */
export const createLightBeamMaterial = ({
  color = "#ffd29a",
  intensity = 1,
  reach = 1,
}: LightBeamOptions = {}): LightBeamMaterial => {
  const tint = uniform(new THREE.Color(color));
  const strength = uniform(intensity);
  const far = uniform(reach);
  const along = positionGeometry.z;
  // Ramps up just past the start and fades to zero at `reach`.
  const fade = smoothstep(float(0), float(0.06), along).mul(
    pow(float(1).sub(smoothstep(float(0), far, along)), float(1.4)),
  );
  // Fade faces seen edge-on so the box reads as a volume rather than as flat sides.
  const edge = pow(abs(dot(normalView, positionViewDirection)), float(1.6));
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.colorNode = tint;
  material.opacityNode = fade.mul(edge).mul(strength).mul(0.5);
  material.fog = false;
  material.name = "apricot:light-beam";
  return {
    material,
    set: (options) => {
      if (options.color !== undefined) tint.value.set(options.color);
      if (options.intensity !== undefined) strength.value = options.intensity;
      if (options.reach !== undefined) far.value = options.reach;
    },
  };
};

/** A 1 × 1 box from z = 0 to z = 1, to be scaled from a light beam's start to its end. */
export const createLightBeamGeometry = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);

/**
 * Where light entering an opening at `from` and travelling along `along`
 * (the negated sun direction) lands. That is on the floor at height
 * `floor`, or on a wall of `bounds` ([minX, minZ, maxX, maxZ]) if it reaches
 * one first. Returns null when the light travels level or upwards.
 */
export const beamEnd = (
  from: Vec3,
  along: Vec3,
  { floor = 0, bounds }: { floor?: number; bounds?: readonly [number, number, number, number] } = {},
): Vec3 | null => {
  const [fx, fy, fz] = from;
  const [ax, ay, az] = along;
  if (ay >= -1e-6 || fy <= floor) return null;
  let t = (floor - fy) / ay;
  if (bounds) {
    const [minX, minZ, maxX, maxZ] = bounds;
    // The first wall hit, given that `from` is on or inside the bounds.
    if (ax > 1e-6) t = Math.min(t, (maxX - fx) / ax);
    if (ax < -1e-6) t = Math.min(t, (minX - fx) / ax);
    if (az > 1e-6) t = Math.min(t, (maxZ - fz) / az);
    if (az < -1e-6) t = Math.min(t, (minZ - fz) / az);
    t = Math.max(t, 0);
  }
  return [fx + ax * t, fy + ay * t, fz + az * t];
};

/**
 * How much light travelling along `along` enters an opening whose normal
 * `facing` points into the room, from 0 to 1. It is 1 head-on, less at
 * grazing angles and 0 from behind the wall.
 */
export const beamStrength = (facing: Vec3, along: Vec3) => {
  const n = Math.hypot(...facing) * Math.hypot(...along);
  if (n === 0) return 0;
  const cos = (facing[0] * along[0] + facing[1] * along[1] + facing[2] * along[2]) / n;
  // Smooth fade-in from grazing angles so the beam does not appear suddenly as the sun moves.
  const x = Math.min(1, Math.max(0, cos / 0.35));
  return x * x * (3 - 2 * x);
};
