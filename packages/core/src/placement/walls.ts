import * as THREE from "three/webgpu";
import { type Extent, type Footprint, keepInside, type PlacementBounds, snap, snapTurn } from "./footprint";
import { cornersOf, overlap, type Placed, separate } from "./overlap";
import { rayThrough } from "./screen";

/**
 * A vertical face that things hang on, running from `from` to `to` on the
 * floor and `height` tall. Its face looks along `inward`, into the room or
 * to one side of a partition. A free-standing wall is two walls, one per face.
 */
export interface Wall {
  /** The wall's index among those of a <Placement>. */
  index: number;
  /** Where its face starts on the floor: [x, z]. */
  from: readonly [number, number];
  /** Where its face ends on the floor: [x, z]. */
  to: readonly [number, number];
  /** Height in metres. */
  height: number;
  /** Unit vector [x, z] pointing out from the face. */
  inward: [number, number];
  /** The turn in degrees that faces a hung object out from the wall, with its back to it. */
  turn: number;
}

/** The wall along `from` → `to` whose face looks along `inward` (normalised here). */
const wallFacing = (
  index: number,
  from: readonly [number, number],
  to: readonly [number, number],
  inward: readonly [number, number],
  height: number,
): Wall => {
  const length = Math.hypot(inward[0], inward[1]) || 1;
  const n: [number, number] = [inward[0] / length, inward[1] / length];
  // An object turned `turn` degrees faces (sin, cos), its local +z.
  const turn = snapTurn(THREE.MathUtils.radToDeg(Math.atan2(n[0], n[1])), 0);
  return { index, from, to, height, inward: n, turn };
};

/** The four inward-facing walls around `bounds`, `height` tall: back (min z), right, front and left. */
export const wallsOf = (bounds: PlacementBounds, height = 2.4): Wall[] => {
  const [minX, minZ, maxX, maxZ] = bounds;
  return [
    wallFacing(0, [minX, minZ], [maxX, minZ], [0, 1], height),
    wallFacing(1, [maxX, minZ], [maxX, maxZ], [-1, 0], height),
    wallFacing(2, [maxX, maxZ], [minX, maxZ], [0, -1], height),
    wallFacing(3, [minX, maxZ], [minX, minZ], [1, 0], height),
  ];
};

/**
 * The inward-facing walls around a room of any shape (an L, a bay, angled
 * corners): one along each side of `outline`, numbered from `first`.
 */
export const wallsAround = (
  outline: readonly (readonly [number, number])[],
  height = 2.4,
  first = 0,
): Wall[] => {
  // The sign of the shoelace sum gives the winding, and so which side of each edge is inside.
  let sum = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++)
    sum += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  const side = sum > 0 ? 1 : -1;
  return outline.map((from, i) => {
    const to = outline[(i + 1) % outline.length];
    const along = [to[0] - from[0], to[1] - from[1]];
    return wallFacing(first + i, from, to, [-along[1] * side, along[0] * side], height);
  });
};

/** A free-standing partition from `from` to `to`: two walls, one per face, numbered from `first`. */
export const wallsAlong = (
  from: readonly [number, number],
  to: readonly [number, number],
  height = 2.4,
  first = 0,
): Wall[] => {
  const along = [to[0] - from[0], to[1] - from[1]];
  return [
    wallFacing(first, from, to, [-along[1], along[0]], height),
    wallFacing(first + 1, to, from, [along[1], -along[0]], height),
  ];
};

/** The direction along a wall that a hung object's local +x points. */
const alongOf = (wall: Wall) => [wall.inward[1], -wall.inward[0]] as const;

/** Floor point (x, z) in wall coordinates: distance along the wall from its start, and out from its face. */
const wallAt = (wall: Wall, x: number, z: number) => {
  const [ax, az] = alongOf(wall);
  const dx = x - wall.from[0];
  const dz = z - wall.from[1];
  return { along: dx * ax + dz * az, out: dx * wall.inward[0] + dz * wall.inward[1] };
};

/** The range of `along` values the wall's face covers. */
const spanOf = (wall: Wall) => {
  const end = wallAt(wall, wall.to[0], wall.to[1]).along;
  return [Math.min(0, end), Math.max(0, end)] as const;
};

/** How far along `wall` the floor point (x, z) is, in the direction hung objects' +x points. */
export const alongWall = (wall: Wall, x: number, z: number) => wallAt(wall, x, z).along;

/**
 * Moves (x, z) flush against any of `walls` that an object covering
 * `footprint`, turned `turn` degrees, comes within `distance` of, measured
 * from the room side. Furniture then sits against a wall instead of
 * stopping a few centimetres short. Works for walls at any angle; in a
 * corner the object is moved against both.
 */
export const snapToWalls = (
  x: number,
  z: number,
  footprint: Footprint,
  turn: number,
  walls: readonly Wall[],
  distance: number,
): [number, number] => {
  for (const wall of walls) {
    const corners = cornersOf({ x, z, turn, footprint });
    if (wallAt(wall, x, z).out <= 0) continue;
    const [low, high] = spanOf(wall);
    const along = corners.map(([cx, cz]) => wallAt(wall, cx, cz).along);
    if (Math.max(...along) <= low || Math.min(...along) >= high) continue;
    // Move by the gap between the face and the nearest corner.
    const gap = Math.min(...corners.map(([cx, cz]) => wallAt(wall, cx, cz).out));
    if (Math.abs(gap) > distance || gap === 0) continue;
    x -= gap * wall.inward[0];
    z -= gap * wall.inward[1];
  }
  return [x, z];
};

/**
 * Whether a camera at `eye` sees the face of `wall`, that is, stands on the
 * side the face looks towards. Only such walls accept objects by hand, so
 * the cut-away sides of a dollhouse room seen from outside take nothing.
 */
export const facesWall = (wall: Wall, eye: THREE.Vector3) => wallAt(wall, eye.x, eye.z).out > 0;

const wallPlane = new THREE.Plane();
const wallNormal = new THREE.Vector3();

/**
 * Where the line of sight through view point (x, y) meets the nearest
 * visible face among `walls`. The hit must lie between the wall's ends and
 * between the floor and the top, allowing `slack` metres above and below so
 * a finger can drag an object up past the top. Returns null when no face
 * is hit.
 */
export const wallPoint = (
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number,
  walls: readonly Wall[],
  { slack = 0 }: { slack?: number } = {},
): { wall: Wall; point: THREE.Vector3 } | null => {
  if (width <= 0 || height <= 0) return null;
  const ray = rayThrough(camera, x, y, width, height);
  const eye = ray.origin;
  let best: { wall: Wall; point: THREE.Vector3 } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const wall of walls) {
    if (!facesWall(wall, eye)) continue;
    wallNormal.set(wall.inward[0], 0, wall.inward[1]);
    // The face's plane: inward · p = inward · from.
    wallPlane.set(wallNormal, -(wall.inward[0] * wall.from[0] + wall.inward[1] * wall.from[1]));
    const hit = ray.intersectPlane(wallPlane, new THREE.Vector3());
    if (!hit) continue;
    const along = wallAt(wall, hit.x, hit.z).along;
    const [low, high] = spanOf(wall);
    if (
      along < low - 1e-6 ||
      along > high + 1e-6 ||
      hit.y < -slack - 1e-6 ||
      hit.y > wall.height + slack + 1e-6
    )
      continue;
    const distance = hit.distanceTo(eye);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { wall, point: hit };
    }
  }
  return best;
};

/** An object hung on a wall: its position and its extent (see hangOn). */
export interface Hung {
  position: readonly [number, number, number];
  extent: Extent;
}

/** An extent's outline on a wall face: x along the wall in the object's own direction, and "z" up. */
const faceOf = (e: Extent): Footprint => ({ minX: e.minX, maxX: e.maxX, minZ: e.minY, maxZ: e.maxY });

/** A hung object as a Placed rectangle in wall-face coordinates (along, up). */
const onFace = (wall: Wall, hung: Hung): Placed => ({
  x: alongWall(wall, hung.position[0], hung.position[2]),
  z: hung.position[1],
  turn: 0,
  footprint: faceOf(hung.extent),
});

/** Whether two objects hung on the same `wall` overlap on it. Touching does not count. */
export const hungOverlap = (wall: Wall, a: Hung, b: Hung) =>
  overlap(onFace(wall, a), onFace(wall, b)) !== null;

/**
 * The position for an object with `extent` hung on `wall` when a finger
 * points at `point` on it, `offset` (along the wall as in alongWall, and up)
 * from where the object was grabbed. The object sits with its back flush
 * against the wall, facing out. It is kept between the wall's ends and
 * between floor and top, snapped to `grid`, and moved clear of `others` on
 * the same wall, backing out towards `was` (its previous position) if
 * given. Returns null when there is no room.
 */
export const hangOn = (
  wall: Wall,
  point: THREE.Vector3,
  offset: readonly [number, number],
  extent: Extent,
  {
    grid = 0,
    others = [],
    was,
  }: { grid?: number; others?: readonly Hung[]; was?: readonly [number, number, number] } = {},
): [number, number, number] | null => {
  const [low, high] = spanOf(wall);
  const area: PlacementBounds = [low, 0, high, wall.height];
  const face = faceOf(extent);
  const wanted = snap(alongWall(wall, point.x, point.z) + offset[0], grid);
  const [along, up] = keepInside(wanted, snap(point.y + offset[1], grid), face, area);
  const free = separate(
    { x: along, z: up, turn: 0, footprint: face },
    others.map((o) => onFace(wall, o)),
    area,
    was ? { x: alongWall(wall, was[0], was[2]), z: was[1] } : undefined,
  );
  if (!free) return null;
  // The object's back (its local -z side) touches the face, so its origin sits -minZ out from the wall.
  const [ax, az] = alongOf(wall);
  const out = -extent.minZ;
  return [
    wall.from[0] + ax * free[0] + wall.inward[0] * out,
    free[1],
    wall.from[1] + az * free[0] + wall.inward[1] * out,
  ];
};
