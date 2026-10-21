import {
  covers,
  type Footprint,
  hungOverlap,
  keepOn,
  overlap,
  type Placed,
  separate,
  type Vec3,
  type Wall,
} from "@apricotjs/core";
import { boxAt, boxesApart, reachOf } from "./geometry";
import { EMPTY, type Item, type Measured, ON_TOP, placedAt, placedOf, topOf, xyz } from "./item";
import type { NearIndex } from "./nearIndex";
import { areaAt, confine, inArea, insideBounds, type Space, zonesAt } from "./space";
import type { Place } from "./types";
import { flushOn, wallOfHung } from "./walls";

/** Whether `m`, reaching `reachM`, is too far from something at (x, z) reaching `reach` to touch it at any turn. */
export const tooFar = (m: Measured, reachM: number, x: number, z: number, reach: number) => {
  const far = reach + reachM;
  const at = m.item.shown.position;
  return Math.abs(at.x - x) > far || Math.abs(at.z - z) > far;
};

/** What stands on `surface`, judged by where items are shown now. */
export const ridersOf = (surface: Measured, all: Measured[]) => {
  if (!surface.item.surface) return [];
  const top = topOf(surface);
  const area = placedOf(surface);
  return all.filter(
    (m) =>
      m.item !== surface.item &&
      m.item.on === "surface" &&
      Math.abs(m.item.shown.position.y - top) <= ON_TOP &&
      covers(area, m.item.shown.position.x, m.item.shown.position.z),
  );
};

/** Splits `all` into what stands on `moving` and everything else except `moving` itself. */
export const apart = (moving: Measured, all: Measured[]) => {
  const riders = ridersOf(moving, all);
  const others = all.filter((m) => m !== moving && !riders.includes(m));
  return { riders, others };
};

/** The surface under something standing at (x, y, z), or null. */
export const supportOf = (x: number, y: number, z: number, surfaces: Measured[]) =>
  surfaces.find((s) => Math.abs(topOf(s) - y) <= ON_TOP && covers(placedOf(s), x, z)) ?? null;

/** The surface among `others` that `item` stands on at (x, y, z), if it is placed on surfaces. */
export const supportFor = (item: Item, x: number, y: number, z: number, others: Measured[]) =>
  item.on === "surface"
    ? supportOf(
        x,
        y,
        z,
        others.filter((m) => m.item.surface),
      )
    : null;

/**
 * Whether `m` blocks `moving` at height `level`, on `support` or the floor.
 * Only solid items on the same level block each other.
 */
const isObstacle = (moving: Measured, level: number, support: Measured | null, m: Measured) => {
  const { item } = m;
  if (!item.solid || !moving.item.solid || item.on === "wall" || m === support) return false;
  // A model still loading blocks nothing.
  if (m.extent === EMPTY || moving.extent === EMPTY) return false;
  // Floating and ground items never block each other, since their areas keep them apart.
  if ((item.on === "water") !== (moving.item.on === "water")) return false;
  if (support) return item.on === "surface" && supportOf(...xyz(item), [support]) === support;
  return Math.abs(item.shown.position.y - level) <= ON_TOP;
};

const obstaclesFor = (moving: Measured, level: number, support: Measured | null, others: Measured[]) =>
  others.filter((m) => isObstacle(moving, level, support, m));

/**
 * Where `moving` may stand near (x, z), turned `turn`, at `level` on
 * `support` or the floor: confined to its space and pushed out of what it
 * would overlap, back towards `from`. Null when there is no room.
 */
export const settle = (
  space: Space,
  moving: Measured,
  x: number,
  z: number,
  turn: number,
  level: number,
  support: Measured | null,
  others: Measured[],
  from?: { x: number; z: number },
): [number, number] | null => {
  const { bounds, partitions } = space;
  const kept = confine(space, moving, x, z, turn, support, from);
  if (!kept) return null;
  [x, z] = kept;
  const obstacles = obstaclesFor(moving, level, support, others).map(placedOf);
  if (!support && moving.extent !== EMPTY) obstacles.push(...partitions);
  if (obstacles.length === 0) return [x, z];
  const free = separate(placedAt(moving.extent, x, z, turn), obstacles, support ? undefined : bounds, from);
  if (!free || !support) return free;
  // Sliding out of the way must not push it off the surface.
  const [kx, kz] = keepOn(free[0], free[1], moving.extent, turn, placedOf(support));
  return Math.abs(kx - free[0]) > 1e-6 || Math.abs(kz - free[1]) > 1e-6 ? null : free;
};

/** The ids of the solid items `moving` overlaps at (x, z), turned `turn`, at `level`. */
export const overlapsAt = (
  moving: Measured,
  x: number,
  z: number,
  turn: number,
  level: number,
  support: Measured | null,
  others: Measured[],
) => {
  const here = placedAt(moving.extent, x, z, turn);
  const reach = reachOf(moving.extent);
  return obstaclesFor(moving, level, support, others)
    .filter((m) => !tooFar(m, reachOf(m.extent), x, z, reach) && overlap(here, placedOf(m)) !== null)
    .map((m) => m.item.id);
};

/** Whether `moving` would overlap something at (x, z), looking only at the items `near` lists there. */
export const overlapsNear = (
  moving: Measured,
  near: NearIndex,
  x: number,
  z: number,
  turn: number,
  level: number,
  support: Measured | null,
) => {
  const reach = reachOf(moving.extent);
  let here: Placed | null = null;
  let box: Footprint | null = null;
  for (const { m, reach: reachM, box: theirs } of near.around(x, z, reach)) {
    if (tooFar(m, reachM, x, z, reach) || !isObstacle(moving, level, support, m)) continue;
    // Separate axis-aligned boxes rule out an overlap cheaply. For quarter turns they are exact.
    box ??= boxAt(moving.extent, x, z, turn);
    if (boxesApart(box, theirs)) continue;
    here ??= placedAt(moving.extent, x, z, turn);
    if (overlap(here, placedOf(m)) !== null) return true;
  }
  return false;
};

/** The solid items hung on `wall` that `moving` must not overlap. */
export const hungOn = (space: Space, moving: Measured, wall: Wall, others: Measured[]) =>
  others.filter(
    (m) =>
      m.item.on === "wall" &&
      m.item.solid &&
      moving.item.solid &&
      wallOfHung(space.walls, xyz(m.item), m.item.shown.turn, m.extent)?.index === wall.index,
  );

/** The ids of the solid items hung on `wall` that `moving` overlaps at `position`. */
export const overlapsOnWall = (
  space: Space,
  moving: Measured,
  wall: Wall,
  position: Vec3,
  others: Measured[],
) =>
  hungOn(space, moving, wall, others)
    .filter((m) =>
      hungOverlap(wall, { position, extent: moving.extent }, { position: xyz(m.item), extent: m.extent }),
    )
    .map((m) => m.item.id);

/**
 * Whether `moving` may be at `place`: it overlaps nothing, touches no zone,
 * is wholly inside the bounds and an area of its kind, and canPlace agrees.
 */
export const allowed = (
  space: Space,
  moving: Measured,
  place: Place,
  standingOn: string | null,
  overlapping: string[],
) => {
  const { item } = moving;
  // A model still loading is checked once it has loaded.
  if (moving.extent === EMPTY) return true;
  const [x, , z] = place.position;
  const ground = item.on !== "wall" && standingOn === null;
  const zones = ground ? zonesAt(space, moving, x, z, place.turn) : [];
  const area = ground ? (areaAt(space, item, x, z)?.id ?? null) : null;
  const agrees =
    space.canPlace?.(item.id, place, { on: item.on, standingOn, overlapping, area, zones }) ?? true;
  return (
    agrees &&
    overlapping.length === 0 &&
    zones.length === 0 &&
    (!ground || (inArea(space, moving, x, z, place.turn) && insideBounds(space, moving, x, z, place.turn)))
  );
};

/**
 * Whether `moving` fits at `place` among `all`, with what stands on it
 * moving along: it is clear of others (unless collide is "off"), on a wall
 * if hung, wholly inside the space, and allowed by canPlace.
 */
export const fitsAt = (space: Space, moving: Measured, place: Place, all: Measured[]) => {
  const { item } = moving;
  const { others } = apart(moving, all);
  const [x, y, z] = place.position;
  let standingOn: string | null = null;
  let over: string[] = [];
  if (item.on === "wall") {
    const wall = wallOfHung(space.walls, place.position, place.turn, moving.extent);
    if (!wall) return moving.extent === EMPTY;
    if (space.collide !== "off") over = overlapsOnWall(space, moving, wall, place.position, others);
  } else {
    const support = supportFor(item, x, y, z, others);
    standingOn = support?.item.id ?? null;
    if (space.collide !== "off") over = overlapsAt(moving, x, z, place.turn, y, support, others);
  }
  return allowed(space, moving, place, standingOn, over);
};

/**
 * Whether `moving`, at the place its props give it, is wholly or partly
 * outside the space: outside the bounds or its areas, or not flush on a
 * wall. An item on a surface counts as inside. A model still loading is
 * never outside.
 */
export const isOutside = (space: Space, moving: Measured, all: Measured[]) => {
  const { item, extent } = moving;
  if (extent === EMPTY) return false;
  const { position, turn } = item.target;
  const [x, y, z] = position;
  if (item.on === "wall") return flushOn(space.walls, position, turn, extent) === null;
  if (item.on === "surface") {
    const others = all.filter((m) => m !== moving && m.item.surface);
    if (supportOf(x, y, z, others)) return false;
  }
  return !inArea(space, moving, x, z, turn) || !insideBounds(space, moving, x, z, turn);
};
