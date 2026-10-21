import {
  alongWall,
  type Extent,
  gridNear,
  gridNearEach,
  keepOn,
  type PlacementBounds,
  turnedFootprint,
  type Vec3,
  type Wall,
} from "@apricotjs/core";
import * as THREE from "three/webgpu";
import { allowed, apart, overlapsNear, overlapsOnWall } from "./checks";
import { extentOf } from "./geometry";
import { EMPTY, type Item, type Measured, placedOf, topOf } from "./item";
import { type NearIndex, nearIndex } from "./nearIndex";
import { levelAt, type Space, spaceFor } from "./space";
import type { FreePlaceOptions, Place, PlaceOn } from "./types";

/** A stand-in item for the object being searched for. */
const probeItem = (id: string, on: PlaceOn, solid: boolean, turn: number): Item => {
  const here: Place = { position: [0, 0, 0], turn };
  return {
    id,
    group: new THREE.Group(),
    locked: false,
    on,
    surface: false,
    solid,
    target: here,
    shown: { position: new THREE.Vector3(), turn },
    held: false,
    fitted: here,
  };
};

const distanceTo = (m: Measured, [x, z]: readonly [number, number]) =>
  Math.hypot(m.item.shown.position.x - x, m.item.shown.position.z - z);

/**
 * Finds a place where an object fits. See PlacementHandle.findFreePlace.
 * `self` is the item with `options.id`, if there is one; `measure` and
 * `placed` measure items as <Placement> does.
 */
export const findFreePlace = (
  space: Space,
  options: FreePlaceOptions,
  self: Item | undefined,
  measure: (item: Item) => Measured,
  placed: () => Measured[],
): Place | null => {
  const { size, extent: given, id = "", near, step, height = 1.5 } = options;
  const { on = self?.on ?? "floor", turn = self?.target.turn ?? 0, solid = self?.solid ?? true } = options;
  const measured = self && !given && !size ? measure(self).extent : null;
  if (measured === EMPTY) return null;
  const extent = given ?? (size ? extentOf(size, on) : measured);
  if (!extent)
    throw new Error(
      `[apricot] findFreePlace needs a size or an extent, or the id of a thing in the placement${id ? ` (none is "${id}")` : ""}`,
    );
  const moving: Measured = { item: probeItem(id, on, solid, turn), extent };
  let others = placed();
  const own = self && others.find((m) => m.item === self);
  // An item already in the placement does not block itself or what stands on it.
  if (own) others = apart(own, others).others;
  const grid = step ?? (space.steps.grid || 0.1);
  if (on === "wall") return hangFree(space, moving, others, grid, height, near);
  const index = nearIndex(others);
  const bounds = spaceFor(space, moving.item);
  const middle: [number, number] = bounds
    ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
    : [0, 0];
  const from = near ?? middle;
  if (on === "surface") {
    const found = onSurfaces(space, moving, others, index, grid, from, near);
    if (found) return found;
  }
  // Without bounds or areas, search a 10 m square around `from`.
  const area: PlacementBounds = bounds ?? [from[0] - 5, from[1] - 5, from[0] + 5, from[1] + 5];
  for (const [x, z] of gridNearEach(area, from, grid)) {
    const y = levelAt(space, moving.item, x, z, 0);
    if (overlapsNear(moving, index, x, z, turn, y, null)) continue;
    const place: Place = { position: [x, y, z], turn };
    if (allowed(space, moving, place, null, [])) return place;
  }
  return null;
};

/** A place on top of a surface among `others`, trying the surfaces nearest `from` first. */
const onSurfaces = (
  space: Space,
  moving: Measured,
  others: Measured[],
  index: NearIndex,
  grid: number,
  from: readonly [number, number],
  near: readonly [number, number] | undefined,
): Place | null => {
  const { extent } = moving;
  const { turn } = moving.item.shown;
  const surfaces = others
    .filter((m) => m.item.surface && m.extent !== EMPTY)
    .sort((a, b) => distanceTo(a, from) - distanceTo(b, from));
  for (const support of surfaces) {
    const top = placedOf(support);
    const box = turnedFootprint(support.extent, top.turn);
    const area: PlacementBounds = [top.x + box.minX, top.z + box.minZ, top.x + box.maxX, top.z + box.maxZ];
    const y = topOf(support);
    for (const [x, z] of gridNearEach(area, near ?? [top.x, top.z], grid)) {
      // Skip points where it would not be wholly on the surface.
      const [kx, kz] = keepOn(x, z, extent, turn, top);
      if (Math.abs(kx - x) > 1e-6 || Math.abs(kz - z) > 1e-6) continue;
      if (overlapsNear(moving, index, x, z, turn, y, support)) continue;
      const place: Place = { position: [x, y, z], turn };
      if (allowed(space, moving, place, support.item.id, [])) return place;
    }
  }
  return null;
};

const middleOf = (wall: Wall) => [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2];

/** The range of (along, up) positions for an origin that keep `extent` wholly on `wall`. */
const rangeOn = (wall: Wall, extent: Extent): PlacementBounds => {
  const end = alongWall(wall, wall.to[0], wall.to[1]);
  const [low, high] = [Math.min(0, end), Math.max(0, end)];
  return [low - extent.minX, -extent.minY, high - extent.maxX, wall.height - extent.maxY];
};

/** A place on the walls for `moving`, on the wall nearest `near` and at `height` if there is room. */
const hangFree = (
  space: Space,
  moving: Measured,
  others: Measured[],
  grid: number,
  height: number,
  near?: readonly [number, number],
): Place | null => {
  const { extent } = moving;
  const walls = [...space.walls].sort((a, b) =>
    near
      ? Math.hypot(middleOf(a)[0] - near[0], middleOf(a)[1] - near[1]) -
        Math.hypot(middleOf(b)[0] - near[0], middleOf(b)[1] - near[1])
      : 0,
  );
  for (const wall of walls) {
    const end = alongWall(wall, wall.to[0], wall.to[1]);
    const along = near ? alongWall(wall, near[0], near[1]) : (Math.min(0, end) + Math.max(0, end)) / 2;
    const [ax, az] = [wall.inward[1], -wall.inward[0]];
    // Position 0 along the wall is `wall.from`; the origin sits off the face by the extent's back.
    const base = [wall.from[0] - wall.inward[0] * extent.minZ, wall.from[1] - wall.inward[1] * extent.minZ];
    // Points beside it at the same height come first. A step up or down costs as much as four sideways.
    const cost = ([u, y]: readonly number[]) => Math.abs(u - along) + 4 * Math.abs(y - height);
    const points = gridNear(rangeOn(wall, extent), [along, height], grid).sort((a, b) => cost(a) - cost(b));
    for (const [u, y] of points) {
      const position: Vec3 = [base[0] + ax * u, y, base[1] + az * u];
      if (overlapsOnWall(space, moving, wall, position, others).length) continue;
      const place: Place = { position, turn: wall.turn };
      if (allowed(space, moving, place, null, [])) return place;
    }
  }
  return null;
};
