import {
  alongWall,
  type Extent,
  type Outline,
  type Placed,
  type PlacementBounds,
  type Wall,
  wallsAlong,
  wallsAround,
  wallsOf,
} from "@apricotjs/core";
import { shortestTurn } from "./geometry";
import type { WallLine } from "./types";

/** Thickness of a free-standing wall for floor objects, in metres. */
const PARTITION = 0.02;

export const isLine = (wall: Outline | WallLine): wall is WallLine => !Array.isArray(wall);

/** The faces of `walls`, numbered in order. Without `walls`, the four faces around `bounds`, or none. */
export const facesOf = (
  walls: readonly (Outline | WallLine)[] | undefined,
  bounds: PlacementBounds | undefined,
  height: number,
) => {
  if (!walls) return bounds ? wallsOf(bounds, height) : [];
  const faces: Wall[] = [];
  for (const wall of walls)
    faces.push(
      ...(isLine(wall)
        ? wallsAlong(wall.from, wall.to, wall.height ?? height, faces.length)
        : wallsAround(wall, height, faces.length)),
    );
  return faces;
};

/** A free-standing wall as floor objects meet it: a thin box along its line. */
export const partitionOf = ({ from, to }: WallLine): Placed => {
  const [face] = wallsAlong(from, to);
  const half = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
  return {
    x: (from[0] + to[0]) / 2,
    z: (from[1] + to[1]) / 2,
    turn: face.turn,
    footprint: { minX: -half, maxX: half, minZ: -PARTITION / 2, maxZ: PARTITION / 2 },
  };
};

/** Signed distance from `wall`'s face to (x, z), positive into the room. */
const outFrom = (wall: Wall, x: number, z: number) =>
  (x - wall.from[0]) * wall.inward[0] + (z - wall.from[1]) * wall.inward[1];

/**
 * The wall that an object hung at `position` and turned `turn` is on: the
 * one facing its way whose face is nearest its back. Null if no wall faces
 * its way.
 */
export const wallOfHung = (
  walls: readonly Wall[],
  position: readonly number[],
  turn: number,
  extent: Extent,
) => {
  let best: Wall | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    if (Math.abs(shortestTurn(wall.turn, turn)) > 0.5) continue;
    const [x, , z] = position;
    const along = alongWall(wall, x, z);
    const end = alongWall(wall, wall.to[0], wall.to[1]);
    // Distance of its back from the face, plus how far it is past the wall's ends.
    const away =
      Math.abs(outFrom(wall, x, z) + extent.minZ) +
      Math.max(0, Math.min(0, end) - along, along - Math.max(0, end));
    if (away < nearest) [best, nearest] = [wall, away];
  }
  return best;
};

/**
 * The wall an object hangs on if it is flush with its face (within 2 cm) and
 * wholly on it, or null, for example when the wall moved or was removed.
 */
export const flushOn = (
  walls: readonly Wall[],
  position: readonly number[],
  turn: number,
  extent: Extent,
) => {
  const wall = wallOfHung(walls, position, turn, extent);
  if (!wall) return null;
  const [x, y, z] = position;
  const off = outFrom(wall, x, z) + extent.minZ;
  const along = alongWall(wall, x, z);
  const end = alongWall(wall, wall.to[0], wall.to[1]);
  const on =
    Math.abs(off) <= 0.02 &&
    along + extent.minX >= Math.min(0, end) - 1e-3 &&
    along + extent.maxX <= Math.max(0, end) + 1e-3 &&
    y + extent.minY >= -1e-3 &&
    y + extent.maxY <= wall.height + 1e-3;
  return on ? wall : null;
};
