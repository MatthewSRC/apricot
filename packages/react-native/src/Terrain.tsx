import {
  createTerrainGeometry,
  createTerrainWaterGeometry,
  type HeightAt,
  type TerrainOptions,
} from "@apricotjs/core";
import type { Ref } from "react";
import { useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import type { SceneObject } from "./parent";
import type { ShadowProps } from "./shadow";
import { Mesh } from "./shapes";
import type { TransformProps } from "./transform";

export interface TerrainProps extends TerrainOptions, TransformProps, ShadowProps {
  /** Width (x) and depth (z) of the tile, in metres, centred on its position. */
  size: readonly [number, number];
  /**
   * The ground's height at (x, z). A new function here, or for `color` or
   * `sides`, rebuilds the geometry, so keep them stable.
   */
  height: HeightAt;
  /** Roughness from 0 (polished) to 1 (default 0.9). */
  roughness?: number;
  /**
   * Water up to `level`. Where the ground is lower, the cut sides show the
   * water's depth, from `top` at the surface to `deep` below. For the surface,
   * add a <Water> of the same size at that level.
   */
  water?: {
    level: number;
    top?: THREE.ColorRepresentation;
    deep?: THREE.ColorRepresentation;
    /** Depth in metres at which the colour is fully `deep` (default 1). */
    fade?: number;
    /** How much of what is behind shows through, from 0 to 1 (default 0.25). */
    clarity?: number;
  };
  name?: string;
  ref?: Ref<SceneObject>;
}

/**
 * A tile of ground of any height, cut square at its edges like a slice of
 * earth, for dioramas of a beach running into the sea, a hill or a riverbank.
 * It is coloured per point (`color`), shows layers in the cut (`sides`), and
 * shows the water's depth through the cut where it has `water`.
 *
 *   const height = (x, z) => (x > shoreAt(z) ? 0.15 : -0.3);
 *   <Terrain size={[8, 6]} height={height} color={(x, z, y) => (y > 0 ? sand : wetSand)}
 *     sides={(y) => (y > -0.1 ? sand : rock)} water={{ level: 0 }} />
 */
export function Terrain({
  size: [width, depth],
  height,
  spacing = 0.1,
  base,
  color,
  sides,
  roughness = 0.9,
  water,
  ref,
  ...props
}: TerrainProps) {
  const ground = useMemo(
    () => createTerrainGeometry(width, depth, height, { spacing, base, color, sides }),
    [width, depth, height, spacing, base, color, sides],
  );
  const material = useMemo(
    () => new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness }),
    [roughness],
  );
  const { level, top, deep, fade, clarity = 0.25 } = water ?? { level: Number.NaN };
  const hasWater = water !== undefined;
  const waterSides = useMemo(
    () =>
      hasWater ? createTerrainWaterGeometry(width, depth, height, level, { spacing, top, deep, fade }) : null,
    [width, depth, height, spacing, level, top, deep, fade, hasWater],
  );
  const waterMaterial = useMemo(
    () =>
      new THREE.MeshStandardNodeMaterial({
        vertexColors: true,
        roughness: 0.1,
        transparent: clarity > 0,
        opacity: 1 - clarity,
        depthWrite: clarity === 0,
      }),
    [clarity],
  );
  useEffect(() => () => ground.dispose(), [ground]);
  useEffect(() => () => waterSides?.dispose(), [waterSides]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => waterMaterial.dispose(), [waterMaterial]);
  return (
    <Mesh ref={ref} geometry={ground} material={material} {...props}>
      {waterSides ? <Mesh geometry={waterSides} material={waterMaterial} castShadow={false} /> : null}
    </Mesh>
  );
}
