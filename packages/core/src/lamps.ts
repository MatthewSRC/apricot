import { DynamicLighting } from "three/addons/lighting/DynamicLighting.js";
import { dot, float, normalView, positionViewDirection, pow, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

/** A light source such as a lamp bulb or a candle. See LampPool. */
export interface LampSource {
  /** The light is placed at this object's world position. */
  object: THREE.Object3D;
  color: THREE.Color;
  /** Intensity when fully on, in candela as for three.js point lights. */
  intensity: number;
  /** Range in metres (0 for no limit). */
  distance: number;
  /** How far the lamp is switched on, from 0 (off) to 1 (on), for fading. */
  level: number;
}

/**
 * A fixed set of point lights shared by every lamp in a scene. Shaders are
 * compiled for the number of lights in the scene, so adding a light would
 * recompile every shader. The pool's lights exist from the start, dark
 * until used, and each update assigns them to the brightest lamps. Lamps
 * beyond the pool's size get no light. Point lights cast no shadows.
 *
 * With `dynamic`, for a renderer set up with applyDynamicLighting, unused
 * lights are hidden instead of dark. Shaders then loop over the visible
 * lights, so unused ones cost nothing and the pool can be large.
 */
export class LampPool {
  /** The pool's lights. They are added to the scene on construction. */
  readonly lights: THREE.PointLight[];
  private readonly sources = new Set<LampSource>();
  private assigned: (LampSource | null)[];
  private readonly at = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    count: number,
    private readonly dynamic = false,
  ) {
    this.lights = Array.from({ length: Math.max(0, Math.floor(count)) }, () => {
      const light = new THREE.PointLight("#ffffff", 0, 3, 2);
      light.name = "Lamp";
      scene.add(light);
      return light;
    });
    this.assigned = this.lights.map(() => null);
  }

  /** Adds `source`, which gets a light while it is among the brightest. Returns a function that removes it. */
  add(source: LampSource) {
    this.sources.add(source);
    return () => {
      this.sources.delete(source);
    };
  }

  /** The sources currently assigned a light. */
  get shining(): readonly LampSource[] {
    return this.assigned.filter((s): s is LampSource => s !== null);
  }

  /** Assigns the lights to the brightest sources and moves them into place. Call before each frame. */
  update() {
    const { lights } = this;
    if (lights.length === 0) return;
    const glow = (s: LampSource) => s.level * s.intensity;
    const lit = [...this.sources]
      .filter((s) => glow(s) > 0)
      // Brightest first. On a tie, sources that already have a light come first, which avoids flicker.
      .sort(
        (a, b) => glow(b) - glow(a) || Number(this.assigned.includes(b)) - Number(this.assigned.includes(a)),
      )
      .slice(0, lights.length);
    // Sources keep the light they had, so a light never jumps across the scene.
    const next: (LampSource | null)[] = this.assigned.map((s) => (s && lit.includes(s) ? s : null));
    for (const s of lit) if (!next.includes(s)) next[next.indexOf(null)] = s;
    this.assigned = next;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      const source = next[i];
      if (!source) {
        light.intensity = 0;
        // With dynamic lighting, hide unused lights. Keep one visible so shaders still include point lights.
        light.visible = !this.dynamic || i === 0;
        continue;
      }
      light.visible = true;
      source.object.updateWorldMatrix(true, false);
      light.position.copy(source.object.getWorldPosition(this.at));
      light.color.copy(source.color);
      light.intensity = glow(source);
      light.distance = source.distance;
      light.updateMatrixWorld();
    }
  }

  /** Removes the lights from the scene and disposes them. */
  dispose() {
    for (const light of this.lights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.sources.clear();
  }
}

export interface LampGlowOptions {
  color?: THREE.ColorRepresentation;
  /** Brightness from 0 upwards (default 1). */
  strength?: number;
}

/** A lamp glow material and a function to update its settings without rebuilding the shader. */
export interface LampGlowMaterial {
  material: THREE.MeshBasicNodeMaterial;
  set: (options: LampGlowOptions) => void;
}

/**
 * A material for a sphere that draws the soft halo around a lit bulb or a
 * candle flame. It blends additively, brightest in the middle and fading to
 * nothing at the silhouette, so it reads as a glow rather than a ball.
 */
export const createLampGlowMaterial = ({
  color = "#ffd9a0",
  strength = 1,
}: LampGlowOptions = {}): LampGlowMaterial => {
  const tint = uniform(new THREE.Color(color));
  const level = uniform(strength);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = tint;
  material.opacityNode = pow(dot(normalView, positionViewDirection).max(0), float(3)).mul(level).mul(0.6);
  material.fog = false;
  return {
    material,
    set: (options) => {
      if (options.color !== undefined) tint.value.set(options.color);
      if (options.strength !== undefined) level.value = options.strength;
    },
  };
};

/**
 * Enables three.js DynamicLighting on `renderer`. Shaders then receive up to
 * `maxPointLights` point lights as arrays and loop over them, so lights can
 * be added and removed without recompiling. Shadow-casting lights are
 * unaffected. Returns false if `renderer` is not a WebGPURenderer.
 */
export const applyDynamicLighting = (renderer: unknown, maxPointLights = 16) => {
  const target = renderer as { isWebGPURenderer?: boolean; lighting?: unknown } | null;
  if (target?.isWebGPURenderer !== true) return false;
  target.lighting = new DynamicLighting({ maxPointLights: Math.max(1, Math.floor(maxPointLights)) });
  return true;
};
