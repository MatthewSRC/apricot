import { type Extent, type Footprint, type Outline, snapTurn, turnedFootprint } from "@apricotjs/core";
import * as THREE from "three/webgpu";
import type { Place, PlaceOn } from "./types";

/** The signed difference `to - from`, in degrees, in [-180, 180). */
export const shortestTurn = (from: number, to: number) => ((((to - from + 180) % 360) + 360) % 360) - 180;

/** Rotates (x, z) around +y by `turn` degrees, as three.js `rotation.y` does. */
export const turnXZ = (x: number, z: number, turn: number): [number, number] => {
  const a = THREE.MathUtils.degToRad(turn);
  return [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
};

/** Where `rider` ends up when the object it stands on moves from `from` to `to`. */
export const carried = (rider: Place, from: Place, to: Place): Place => {
  const [lx, lz] = turnXZ(
    rider.position[0] - from.position[0],
    rider.position[2] - from.position[2],
    -from.turn,
  );
  const [x, z] = turnXZ(lx, lz, to.turn);
  return {
    position: [to.position[0] + x, rider.position[1] + to.position[1] - from.position[1], to.position[2] + z],
    turn: snapTurn(rider.turn + to.turn - from.turn, 0),
  };
};

export const samePlace = (a: Place, b: Place) =>
  Math.abs(a.position[0] - b.position[0]) <= 1e-6 &&
  Math.abs(a.position[1] - b.position[1]) <= 1e-6 &&
  Math.abs(a.position[2] - b.position[2]) <= 1e-6 &&
  Math.abs(shortestTurn(a.turn, b.turn)) <= 1e-6;

/**
 * The extent of a box `[width, height, depth]` big. Its origin is the middle
 * of its bottom, or the middle of its back when hung on a wall.
 */
export const extentOf = ([width, height, depth]: readonly [number, number, number], on: PlaceOn): Extent =>
  on === "wall"
    ? { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2, minZ: 0, maxZ: depth }
    : { minX: -width / 2, maxX: width / 2, minY: 0, maxY: height, minZ: -depth / 2, maxZ: depth / 2 };

/** How far a footprint reaches from its origin, however it is turned. */
export const reachOf = (f: Footprint) => {
  const x = Math.max(-f.minX, f.maxX);
  const z = Math.max(-f.minZ, f.maxZ);
  return Math.sqrt(x * x + z * z);
};

/** The axis-aligned floor box covered by footprint `f` at (x, z), turned `turn`. */
export const boxAt = (f: Footprint, x: number, z: number, turn: number): Footprint => {
  const turned = turnedFootprint(f, turn);
  return { minX: x + turned.minX, maxX: x + turned.maxX, minZ: z + turned.minZ, maxZ: z + turned.maxZ };
};

/** Whether two floor boxes are apart or only touching. */
export const boxesApart = (a: Footprint, b: Footprint) =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) <= 1e-6 ||
  Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) <= 1e-6;

/** The box [minX, minZ, maxX, maxZ] around every corner of `outlines`. */
export const boxAround = (outlines: readonly Outline[]): [number, number, number, number] => {
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const outline of outlines)
    for (const [x, z] of outline) {
      [minX, maxX] = [Math.min(minX, x), Math.max(maxX, x)];
      [minZ, maxZ] = [Math.min(minZ, z), Math.max(maxZ, z)];
    }
  return [minX, minZ, maxX, maxZ];
};

/** The last entry of `list` that passes `test`. Later areas lie on top of earlier ones. */
export const topmost = <T>(list: readonly T[], test: (value: T) => boolean) => {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i];
  return null;
};
