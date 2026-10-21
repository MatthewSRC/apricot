import * as THREE from "three/webgpu";
import { cornersOf, covers, type Placed } from "./placement";

/** A closed shape on the ground: its (x, z) corners in order, in metres. The last corner joins the first. */
export type Outline = readonly (readonly [number, number])[];

/** Whether ground point (px, pz) is inside `outline`. Works for any simple polygon, concave ones included. */
export const insideOutline = (px: number, pz: number, outline: Outline) => {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i];
    const [xj, zj] = outline[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// Whether segments ab and cd cross. Touching at an end does not count.
const cross = (
  [ax, az]: readonly [number, number],
  [bx, bz]: readonly [number, number],
  [cx, cz]: readonly [number, number],
  [dx, dz]: readonly [number, number],
) => {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = side(cx, cz, dx, dz, ax, az);
  const d2 = side(cx, cz, dx, dz, bx, bz);
  const d3 = side(ax, az, bx, bz, cx, cz);
  const d4 = side(ax, az, bx, bz, dx, dz);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
};

const edgesCross = (corners: readonly (readonly [number, number])[], outline: Outline) => {
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let j = 0, k = outline.length - 1; j < outline.length; k = j++) {
      if (cross(a, b, outline[k], outline[j])) return true;
    }
  }
  return false;
};

/** Whether the whole area `placed` covers is inside `outline`. */
export const placedInside = (placed: Placed, outline: Outline) => {
  const corners = cornersOf(placed);
  if (!corners.every(([x, z]) => insideOutline(x, z, outline))) return false;
  // All corners can be inside while a notch in the outline reaches in between them.
  if (outline.some(([x, z]) => covers(placed, x, z) && !onEdge(placed, x, z))) return false;
  return !edgesCross(corners, outline);
};

// Whether (px, pz) is on the boundary of what `placed` covers rather than strictly inside it.
const onEdge = (placed: Placed, px: number, pz: number) => {
  const shrunk: Placed = {
    ...placed,
    footprint: {
      minX: placed.footprint.minX + 1e-6,
      maxX: placed.footprint.maxX - 1e-6,
      minZ: placed.footprint.minZ + 1e-6,
      maxZ: placed.footprint.maxZ - 1e-6,
    },
  };
  return !covers(shrunk, px, pz);
};

/** Whether the area `placed` covers overlaps `outline` anywhere. Touching does not count. */
export const placedTouches = (placed: Placed, outline: Outline) => {
  const corners = cornersOf(placed);
  // They overlap if a corner is strictly inside the outline, an outline point is strictly inside the area, or edges cross.
  if (corners.some(([x, z]) => insideOutline(x, z, outline) && !nearEdge(x, z, outline))) return true;
  if (outline.some(([x, z]) => covers(placed, x, z) && !onEdge(placed, x, z))) return true;
  return edgesCross(corners, outline);
};

// Whether (px, pz) is within 1e-6 of the outline's edge.
const nearEdge = (px: number, pz: number, outline: Outline) => {
  for (let j = 0, k = outline.length - 1; j < outline.length; k = j++) {
    const [ax, az] = outline[k];
    const [bx, bz] = outline[j];
    const lx = bx - ax;
    const lz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * lx + (pz - az) * lz) / (lx * lx + lz * lz || 1)));
    if (Math.hypot(px - (ax + lx * t), pz - (az + lz * t)) < 1e-6) return true;
  }
  return false;
};

/**
 * Where `placed` can go inside `outline` when moved from `from` to its own
 * (x, z). Returns (x, z) if it fits there. Otherwise it slides along the
 * edge by keeping either x or z from `from`, or else stops as far towards
 * (x, z) as it fits. Returns null if `from` does not fit either.
 */
export const keepWithin = (
  placed: Placed,
  outline: Outline,
  from: { x: number; z: number },
): [number, number] | null => {
  const fits = (x: number, z: number) => placedInside({ ...placed, x, z }, outline);
  const { x, z } = placed;
  if (fits(x, z)) return [x, z];
  // Try keeping the larger of the two moves first.
  const tries: [number, number][] =
    Math.abs(x - from.x) > Math.abs(z - from.z)
      ? [
          [x, from.z],
          [from.x, z],
        ]
      : [
          [from.x, z],
          [x, from.z],
        ];
  for (const [tx, tz] of tries) if (fits(tx, tz)) return towards(fits, [tx, tz], [x, z]);
  if (!fits(from.x, from.z)) return null;
  return towards(fits, [from.x, from.z], [x, z]);
};

// Bisects between `good`, which fits, and `wanted` for the furthest point that fits (12 halvings).
const towards = (
  fits: (x: number, z: number) => boolean,
  good: [number, number],
  wanted: [number, number],
): [number, number] => {
  let [gx, gz] = good;
  let [bx, bz] = wanted;
  for (let i = 0; i < 12; i++) {
    const mx = (gx + bx) / 2;
    const mz = (gz + bz) / 2;
    if (fits(mx, mz)) [gx, gz] = [mx, mz];
    else [bx, bz] = [mx, mz];
  }
  return [gx, gz];
};

/**
 * A smooth closed curve through the corners of `outline`, as an outline of
 * `segments` points. Useful for turning a few points into an island's shore.
 */
export const smoothOutline = (outline: Outline, segments = 96): [number, number][] => {
  const curve = new THREE.CatmullRomCurve3(
    outline.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal",
  );
  return curve
    .getSpacedPoints(segments)
    .slice(0, segments)
    .map((p) => [p.x, p.z]);
};

/** The area inside `outline` in square metres, for either winding. */
export const outlineArea = (outline: Outline) => {
  let sum = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++)
    sum += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  return Math.abs(sum) / 2;
};

export interface SlabOptions {
  /** Thickness in metres. The slab spans y = 0 to this height (default 0.2). */
  height?: number;
  /** Shapes cut all the way through the slab, such as a pool. */
  holes?: readonly Outline[];
  /** Radius of the rounding on the top and bottom edges, in metres (default 0.03). */
  bevel?: number;
}

/**
 * A slab of ground in any shape, such as an island, a lawn or a deck:
 * `outline` minus its `holes`, extruded from y = 0 to `height` with
 * rounded edges.
 */
export const createSlabGeometry = (
  outline: Outline,
  { height = 0.2, holes = [], bevel = 0.03 }: SlabOptions = {},
) => {
  // Draw the shape in (x, -z) and extrude along its z, then rotate so that z becomes height.
  const shapeOf = (points: Outline) => new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const shape = shapeOf(outline);
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  const edge = Math.max(0, Math.min(bevel, height / 2 - 1e-4));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, height - 2 * edge),
    bevelEnabled: edge > 0,
    bevelThickness: edge,
    bevelSize: edge,
    bevelOffset: -edge,
    bevelSegments: 3,
    curveSegments: 8,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, edge, 0);
  return geometry;
};
