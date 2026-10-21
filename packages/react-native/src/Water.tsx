import {
  createShoreField,
  createWaterGeometry,
  createWaterMaterial,
  type Outline,
  type ShoreField,
  setShadow,
  type WaterOptions,
  type WaveOptions,
  Waves,
} from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useMemo, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { type SceneObject, useAttach } from "./parent";
import { type TransformProps, useTransform } from "./transform";

/**
 * Creates waves to share between a <Water> surface and what floats on it,
 * such as a water area of a <Placement>. They are created once; changes to
 * `options` apply live.
 */
export const useWaves = (options: WaveOptions = {}) => {
  const [waves] = useState(() => new Waves(options));
  const { height, length, speed, direction } = options;
  useEffect(() => {
    waves.set({ height, length, speed, direction });
  }, [waves, height, length, speed, direction]);
  return waves;
};

/**
 * Measures how far the water is from the shores of `land` across `bounds`,
 * for <Water shore>. The water is then pale where it meets the sand,
 * turquoise over the shallows and azure further out, with foam along the
 * shore. It is measured again only when the inputs change. `reach` is how
 * far out, in metres, the water deepens (default 4); `size` is the
 * resolution of the distance texture (default 128).
 */
export const useShore = (
  land: readonly Outline[] | ((x: number, z: number) => boolean),
  bounds: readonly [number, number, number, number],
  { reach = 4, size = 128 }: { reach?: number; size?: number } = {},
) => {
  // Outlines are compared by value and a land test by identity, so keep the function stable.
  const key = JSON.stringify([typeof land === "function" ? null : land, bounds, reach, size]);
  const test = typeof land === "function" ? land : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `test` stand for the land and bounds
  const field = useMemo(() => createShoreField(land, bounds, { reach, size }), [key, test]);
  useEffect(() => () => field.texture.dispose(), [field]);
  return field;
};

export interface WaterProps extends Omit<WaterOptions, "waves" | "shore">, Pick<TransformProps, "position"> {
  /** Width and depth of the surface, in metres. It lies level at its position's height. */
  size: readonly [number, number];
  /** The waves that move it (useWaves), shared with what floats on it. Without waves the water is still. */
  waves?: Waves;
  /** Distance from the shore (useShore), for shallows, deep water and foam by the beach. */
  shore?: ShoreField;
  /** Distance between its vertices, in metres (default 0.25). Finer spacing carries shorter waves. */
  spacing?: number;
  ref?: Ref<SceneObject>;
}

/**
 * A water surface, such as the sea around an island, a pool or a pond. Its
 * waves (useWaves) move it and anything floating on it alike, and the scene
 * keeps drawing while there are waves. It always lies level: it can be moved
 * but not rotated.
 *
 *   const sea = useWaves({ height: 0.08, length: 3 });
 *   <Water size={[40, 40]} waves={sea} />
 *   <Placement areas={[{ id: "sea", outline: seaOutline, water: sea }]}>…</Placement>
 */
export function Water({
  size,
  waves,
  shore,
  spacing = 0.25,
  shallow,
  deep,
  shoreline,
  foam,
  caustics,
  glow,
  clarity = 0,
  sparkle,
  scale,
  position,
  ref,
}: WaterProps) {
  const scene = useScene();
  const [width, depth] = size;
  const geometry = useMemo(() => createWaterGeometry(width, depth, spacing), [width, depth, spacing]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Only these need a new shader. Transparency counts because transparent objects sort differently.
  const clear = clarity > 0;
  const frothy = foam !== false;
  // biome-ignore lint/correctness/useExhaustiveDependencies: colours and amounts are live values (set below)
  const water = useMemo(
    () =>
      createWaterMaterial({
        waves,
        shore,
        clarity,
        shallow,
        deep,
        shoreline,
        foam,
        caustics,
        glow,
        sparkle,
        scale,
      }),
    [waves, shore, clear, frothy, scale],
  );
  useEffect(() => () => water.material.dispose(), [water]);
  useEffect(() => {
    water.set({
      shallow,
      deep,
      shoreline,
      foam: foam === false ? undefined : foam,
      caustics,
      glow,
      clarity,
      sparkle,
    });
    scene.invalidate();
  }, [water, shallow, deep, shoreline, foam, caustics, glow, clarity, sparkle, scene]);

  const [mesh] = useState(() => {
    const created = new THREE.Mesh();
    created.name = "Water";
    // It receives shadows, such as a jetty's or a boat's, but casts none.
    setShadow(created, { cast: false, receive: true });
    return created;
  });
  mesh.geometry = geometry;
  mesh.material = water.material;
  useTransform(mesh, { position });
  useImperativeHandle(ref, () => mesh, [mesh]);
  useAttach(mesh);

  useFrame(({ time }) => {
    if (!waves || waves.settings.height === 0) return false;
    waves.tick(time);
    return true;
  });
  return null;
}
