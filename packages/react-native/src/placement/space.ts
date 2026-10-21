import {
  cornersOf,
  insideOutline,
  keepInside,
  keepOn,
  keepWithin,
  type Outline,
  type Placed,
  type PlacementBounds,
  placedInside,
  placedTouches,
  snapToWalls,
  turnedFootprint,
  type Wall,
  type Waves,
} from "@apricotjs/core";
import { boxAround, topmost } from "./geometry";
import { type Item, type Measured, placedAt, placedOf } from "./item";
import type {
  Collide,
  PlacementArea,
  PlacementProps,
  PlacementSnap,
  PlacementZone,
  SnapPoint,
  WallLine,
} from "./types";
import { facesOf, isLine, partitionOf } from "./walls";

/** The rules that decide where objects fit, resolved from <Placement>'s props. */
export interface Space {
  bounds: PlacementBounds | undefined;
  /** Every wall face: those of `walls`, or the four around `bounds`. */
  walls: Wall[];
  /** The free-standing walls, as thin obstacles for floor objects. */
  partitions: Placed[];
  /** The areas, or the room outlines among `walls` when no areas are given. */
  areas: readonly PlacementArea[] | undefined;
  /** The zones, plus a thin zone along each free-standing wall. */
  zones: readonly PlacementZone[] | undefined;
  snaps: readonly SnapPoint[] | undefined;
  steps: PlacementSnap;
  collide: Collide;
  canPlace: PlacementProps["canPlace"];
}

export interface SpaceProps {
  bounds: PlacementBounds | undefined;
  wallHeight: number;
  walls: readonly (Outline | WallLine)[] | undefined;
  areas: readonly PlacementArea[] | undefined;
  zones: readonly PlacementZone[] | undefined;
  snaps: readonly SnapPoint[] | undefined;
  steps: PlacementSnap;
  collide: Collide;
  canPlace: PlacementProps["canPlace"];
}

export const resolveSpace = ({ walls, wallHeight, areas, zones, ...rest }: SpaceProps): Space => {
  const lines = (walls ?? []).flatMap((wall, i) => (isLine(wall) ? [{ wall, i }] : []));
  const rooms = (walls ?? []).filter((wall) => !isLine(wall)) as Outline[];
  const partitions = lines.map(({ wall }) => partitionOf(wall));
  return {
    ...rest,
    walls: facesOf(walls, rest.bounds, wallHeight),
    partitions,
    areas: areas ?? (rooms.length ? rooms.map((outline): PlacementArea => ({ outline })) : undefined),
    zones: lines.length
      ? [
          ...(zones ?? []),
          ...lines.map(({ wall, i }, n) => ({
            id: wall.id ?? `wall ${i}`,
            outline: cornersOf(partitions[n]),
          })),
        ]
      : zones,
  };
};

/** The waves of the water area at (x, z), or null if it has none. */
export const wavesAt = (space: Space, x: number, z: number): Waves | null => {
  const water = topmost(space.areas ?? [], (a) => !!a.water && insideOutline(x, z, a.outline));
  return water && water.water !== true ? (water.water ?? null) : null;
};

/** The areas `item` may stand in: water areas if it floats, the others if not. Null means anywhere. */
export const areasFor = (space: Space, item: Item) => {
  const { areas } = space;
  if (!areas?.length || item.on === "wall") return null;
  return areas.filter((a) => !!a.water === (item.on === "water"));
};

/**
 * The area `item` can move into at (x, z): the topmost area there, if it is
 * of the item's kind. A boat cannot reach the sea under an island.
 */
const reachableAt = (space: Space, item: Item, x: number, z: number) => {
  if (!areasFor(space, item)) return null;
  const top = topmost(space.areas ?? [], (a) => insideOutline(x, z, a.outline));
  return top && !!top.water === (item.on === "water") ? top : null;
};

/** The topmost area of `item`'s kind at (x, z), even when an area of the other kind lies on top. */
export const areaAt = (space: Space, item: Item, x: number, z: number) => {
  const mine = areasFor(space, item);
  return mine ? topmost(mine, (a) => insideOutline(x, z, a.outline)) : null;
};

/** The height `item` stands at on the ground at (x, z): its area's level, or `otherwise`. */
export const levelAt = (space: Space, item: Item, x: number, z: number, otherwise: number) => {
  const area = areaAt(space, item, x, z);
  return area ? (area.level ?? 0) : otherwise;
};

/** The level of the topmost area of any kind at (x, z), or `otherwise`. */
export const levelOver = (space: Space, x: number, z: number, otherwise: number) => {
  const top = topmost(space.areas ?? [], (a) => insideOutline(x, z, a.outline));
  return top ? (top.level ?? 0) : otherwise;
};

/** (x, z) for `moving` turned `turn`, snapped to the walls and kept inside the bounds. */
const inBounds = (space: Space, moving: Measured, x: number, z: number, turn: number): [number, number] => {
  const { steps, bounds, walls } = space;
  if (steps.wall && walls.length) [x, z] = snapToWalls(x, z, moving.extent, turn, walls, steps.wall);
  return bounds ? keepInside(x, z, turnedFootprint(moving.extent, turn), bounds) : [x, z];
};

/** Whether `moving` turned `turn` at (x, z) is wholly inside the bounds, or there are none. */
export const insideBounds = (space: Space, moving: Measured, x: number, z: number, turn: number) => {
  const { bounds } = space;
  if (!bounds) return true;
  const [minX, minZ, maxX, maxZ] = bounds;
  const box = turnedFootprint(moving.extent, turn);
  return (
    x + box.minX >= minX - 1e-4 &&
    x + box.maxX <= maxX + 1e-4 &&
    z + box.minZ >= minZ - 1e-4 &&
    z + box.maxZ <= maxZ + 1e-4
  );
};

/** Whether `moving` turned `turn` at (x, z) is wholly inside a reachable area of its kind, or there are none. */
export const inArea = (space: Space, moving: Measured, x: number, z: number, turn: number) => {
  if (!areasFor(space, moving.item)) return true;
  const area = reachableAt(space, moving.item, x, z);
  return area !== null && placedInside(placedAt(moving.extent, x, z, turn), area.outline);
};

/**
 * (x, z) for `moving` turned `turn`: kept on `support`, or else inside the
 * bounds (snapped to walls) and wholly inside an area, sliding along its edge
 * from `from`. Null when no area can hold it there.
 */
export const confine = (
  space: Space,
  moving: Measured,
  x: number,
  z: number,
  turn: number,
  support: Measured | null,
  from?: { x: number; z: number },
): [number, number] | null => {
  if (support) return keepOn(x, z, moving.extent, turn, placedOf(support));
  [x, z] = inBounds(space, moving, x, z, turn);
  if (!areasFor(space, moving.item)) return [x, z];
  const was = from ?? { x: moving.item.shown.position.x, z: moving.item.shown.position.z };
  // Try the area under the finger first, then the one it comes from.
  for (const area of [reachableAt(space, moving.item, x, z), areaAt(space, moving.item, was.x, was.z)]) {
    if (!area) continue;
    const kept = keepWithin(placedAt(moving.extent, x, z, turn), area.outline, was);
    if (kept) return kept;
  }
  return null;
};

/**
 * (x, z) for `moving` turned `turn` with collide "warn": kept on `support`,
 * inside the bounds, and with its origin inside the box around all areas.
 * It may leave its own kind of area or enter zones; `allowed` reports that.
 */
export const roam = (
  space: Space,
  moving: Measured,
  x: number,
  z: number,
  turn: number,
  support: Measured | null,
): [number, number] => {
  if (support) return keepOn(x, z, moving.extent, turn, placedOf(support));
  [x, z] = inBounds(space, moving, x, z, turn);
  const { areas } = space;
  if (!areas?.length || moving.item.on === "wall") return [x, z];
  const [minX, minZ, maxX, maxZ] = boxAround(areas.map((area) => area.outline));
  return [Math.min(maxX, Math.max(minX, x)), Math.min(maxZ, Math.max(minZ, z))];
};

/**
 * The ids of the zones `moving` touches at (x, z) turned `turn`, and of the
 * areas of the other kind lying on top of its own, such as a pool on an
 * island for a lounger, or the island in the sea for a boat.
 */
export const zonesAt = (space: Space, moving: Measured, x: number, z: number, turn: number) => {
  const { zones = [], areas = [] } = space;
  const here = placedAt(moving.extent, x, z, turn);
  const hit = zones.flatMap((zone, i) => (placedTouches(here, zone.outline) ? [zone.id ?? `zone ${i}`] : []));
  const own = areaAt(space, moving.item, x, z);
  if (own) {
    const water = moving.item.on === "water";
    areas.forEach((area, i) => {
      if (i > areas.indexOf(own) && !!area.water !== water && placedTouches(here, area.outline))
        hit.push(area.id ?? `area ${i}`);
    });
  }
  return hit;
};

/** (x, z, turn) moved onto the nearest snap point in reach that accepts `id`, or unchanged. */
export const snapTo = (
  space: Space,
  id: string,
  x: number,
  z: number,
  turn: number,
): [number, number, number] => {
  let best: SnapPoint | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const point of space.snaps ?? []) {
    const away = Math.hypot(x - point.at[0], z - point.at[1]);
    if (away <= (point.radius ?? 0.3) && away < nearest && (point.accepts?.(id) ?? true)) {
      best = point;
      nearest = away;
    }
  }
  return best ? [best.at[0], best.at[1], best.turn ?? turn] : [x, z, turn];
};

/** The box [minX, minZ, maxX, maxZ] where `item` may stand: the bounds, or around its areas. Null means anywhere. */
export const spaceFor = (space: Space, item: Item): PlacementBounds | null => {
  if (space.bounds) return space.bounds;
  const mine = areasFor(space, item);
  if (!mine?.length) return null;
  return boxAround(mine.map((area) => area.outline));
};
