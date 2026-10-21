import * as THREE from "three/webgpu";
import { type Footprint, keepInside, type PlacementBounds, turnedFootprint } from "./footprint";

/** An object standing at (x, z), turned `turn` degrees. The floor it covers is its footprint, turned and moved there. */
export interface Placed {
  x: number;
  z: number;
  turn: number;
  footprint: Footprint;
}

/** A placed footprint as a turned rectangle: its centre, its two unit axes and its half-size along each. */
const rectOf = ({ x, z, turn, footprint: f }: Placed) => {
  const a = THREE.MathUtils.degToRad(turn);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = (f.minX + f.maxX) / 2;
  const cz = (f.minZ + f.maxZ) / 2;
  return {
    // Rotation around +y, matching three.js: local x maps to (cos, -sin) and local z to (sin, cos).
    x: x + cx * cos + cz * sin,
    z: z - cx * sin + cz * cos,
    axes: [
      [cos, -sin],
      [sin, cos],
    ] as const,
    half: [(f.maxX - f.minX) / 2, (f.maxZ - f.minZ) / 2] as const,
  };
};

type Rect = ReturnType<typeof rectOf>;

/** Half the length of `r`'s projection onto the unit axis (nx, nz). */
const reachAlong = (r: Rect, nx: number, nz: number) =>
  r.half[0] * Math.abs(r.axes[0][0] * nx + r.axes[0][1] * nz) +
  r.half[1] * Math.abs(r.axes[1][0] * nx + r.axes[1][1] * nz);

/** The four (x, z) corners of the floor `placed` covers, in order around its edge. */
export const cornersOf = (placed: Placed): [number, number][] => {
  const { x, z, axes, half } = rectOf(placed);
  const [[ux, uz], [vx, vz]] = axes;
  return [
    [x - ux * half[0] - vx * half[1], z - uz * half[0] - vz * half[1]],
    [x + ux * half[0] - vx * half[1], z + uz * half[0] - vz * half[1]],
    [x + ux * half[0] + vx * half[1], z + uz * half[0] + vz * half[1]],
    [x - ux * half[0] + vx * half[1], z - uz * half[0] + vz * half[1]],
  ];
};

/**
 * How far `a` must move in (x, z) to stop overlapping `b`, or null when
 * they do not overlap. Touching does not count as overlapping, and either
 * may be turned by any amount. Returns the shortest way out, unless `from`
 * gives where `a` was before (clear of `b`). Then `a` backs out on the side
 * it came from, so a dragged object stops against `b` and slides along it
 * instead of jumping over it.
 */
export const overlap = (a: Placed, b: Placed, from?: { x: number; z: number }): [number, number] | null => {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const previous = from ? rectOf({ ...a, ...from }) : null;
  const dx = ra.x - rb.x;
  const dz = ra.z - rb.z;
  let shortest = Number.POSITIVE_INFINITY;
  let push: [number, number] = [0, 0];
  let backShortest = Number.POSITIVE_INFINITY;
  let back: [number, number] | null = null;
  // Separating axis test over both rectangles' axes.
  for (const [nx, nz] of [...ra.axes, ...rb.axes]) {
    const both = reachAlong(ra, nx, nz) + reachAlong(rb, nx, nz);
    const gap = dx * nx + dz * nz;
    const depth = both - Math.abs(gap);
    // Separated along this axis. The tolerance treats rounding-sized overlaps as touching.
    if (depth <= 1e-6) return null;
    if (depth < shortest) {
      shortest = depth;
      const away = gap < 0 ? -1 : 1;
      push = [nx * depth * away, nz * depth * away];
    }
    if (previous) {
      // Only axes along which `a` was clear of `b` before can be backed out along.
      const was = (previous.x - rb.x) * nx + (previous.z - rb.z) * nz;
      if (Math.abs(was) < both - 1e-6) continue;
      const side = was < 0 ? -1 : 1;
      const needed = both - side * gap;
      if (needed < backShortest) {
        backShortest = needed;
        back = [nx * needed * side, nz * needed * side];
      }
    }
  }
  return back ?? push;
};

/**
 * Where `a` can stand close to where it was asked to. It is moved out of
 * everything in `others` that it overlaps, sliding along them (backing out
 * towards `from`, its previous position, if given), and kept inside
 * `bounds`. Returns null when there is no room, for example when it is
 * wedged between other objects.
 */
export const separate = (
  a: Placed,
  others: readonly Placed[],
  bounds?: PlacementBounds,
  from?: { x: number; z: number },
): [number, number] | null => {
  let { x, z } = a;
  const turned = turnedFootprint(a.footprint, a.turn);
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const other of others) {
      const push = overlap({ ...a, x, z }, other, from);
      if (!push) continue;
      // Push slightly further so rounding leaves the two touching rather than overlapping.
      const length = Math.hypot(push[0], push[1]);
      x += push[0] * (1 + 1e-4 / length);
      z += push[1] * (1 + 1e-4 / length);
      moved = true;
    }
    if (bounds) {
      const [bx, bz] = keepInside(x, z, turned, bounds);
      if (Math.abs(bx - x) > 1e-9 || Math.abs(bz - z) > 1e-9) moved = true;
      [x, z] = [bx, bz];
    }
    if (!moved) return [x, z];
  }
  return others.some((other) => overlap({ ...a, x, z }, other)) ? null : [x, z];
};

/** Whether the floor point (px, pz) lies within the area `placed` covers. */
export const covers = (placed: Placed, px: number, pz: number) => {
  const r = rectOf(placed);
  const dx = px - r.x;
  const dz = pz - r.z;
  return (
    Math.abs(dx * r.axes[0][0] + dz * r.axes[0][1]) <= r.half[0] + 1e-9 &&
    Math.abs(dx * r.axes[1][0] + dz * r.axes[1][1]) <= r.half[1] + 1e-9
  );
};

/**
 * Moves an object at (x, z) covering `footprint`, turned `turn` degrees,
 * the least distance that keeps it on top of `surface`, such as a desk.
 */
export const keepOn = (
  x: number,
  z: number,
  footprint: Footprint,
  turn: number,
  surface: Placed,
): [number, number] => {
  const a = THREE.MathUtils.degToRad(surface.turn);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Work in the surface's own unturned space, then turn the result back.
  const lx = x - surface.x;
  const lz = z - surface.z;
  const [ix, iz] = keepInside(
    lx * cos - lz * sin,
    lx * sin + lz * cos,
    turnedFootprint(footprint, turn - surface.turn),
    [surface.footprint.minX, surface.footprint.minZ, surface.footprint.maxX, surface.footprint.maxZ],
  );
  return [surface.x + ix * cos + iz * sin, surface.z - ix * sin + iz * cos];
};
