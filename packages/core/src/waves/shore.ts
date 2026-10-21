import * as THREE from "three/webgpu";
import { insideOutline, type Outline } from "../areas";

/** The distance from each point of the water to the nearest shore. See createShoreField. */
export interface ShoreField {
  /** Distance to the nearest shore across `bounds`, from 0 on the shore to 1 at `reach` metres or more. */
  texture: THREE.DataTexture;
  /** The area covered, [minX, minZ, maxX, maxZ]. Water outside it counts as far from shore. */
  bounds: readonly [number, number, number, number];
  /** The distance in metres over which the water goes from shore to open sea. */
  reach: number;
}

/**
 * Measures how far each point of `bounds` is from the shores of `land`, for
 * use as createWaterMaterial's `shore`. `land` is either a list of outlines
 * or a function that returns whether there is land (ground above the water)
 * at (x, z). The result is a `size` × `size` texture.
 */
export const createShoreField = (
  land: readonly Outline[] | ((x: number, z: number) => boolean),
  bounds: readonly [number, number, number, number],
  { size = 128, reach = 4 }: { size?: number; reach?: number } = {},
): ShoreField => {
  const [minX, minZ, maxX, maxZ] = bounds;
  const xAt = (col: number) => minX + ((col + 0.5) / size) * (maxX - minX);
  const zAt = (row: number) => minZ + ((row + 0.5) / size) * (maxZ - minZ);
  const distances = new Float32Array(size * size).fill(reach);
  if (typeof land === "function") {
    // An exact Euclidean distance transform: one pass down the columns and one along the rows, linear in texels.
    const squared = new Float64Array(size * size);
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++)
        squared[row * size + col] = land(xAt(col), zAt(row)) ? 0 : Number.POSITIVE_INFINITY;
    const along = (step: number, count: number, start: number, spacing: number) =>
      distanceSquared(squared, start, step, count, spacing);
    const width = (maxX - minX) / size;
    const depth = (maxZ - minZ) / size;
    for (let col = 0; col < size; col++) along(size, size, col, depth);
    for (let row = 0; row < size; row++) along(1, size, row * size, width);
    for (let i = 0; i < size * size; i++) distances[i] = Math.min(reach, Math.sqrt(squared[i]));
  } else {
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const x = xAt(col);
        const z = zAt(row);
        let distance = reach;
        for (const outline of land) {
          if (insideOutline(x, z, outline)) {
            distance = 0;
            break;
          }
          distance = Math.min(distance, distanceToOutline(x, z, outline));
        }
        distances[row * size + col] = distance;
      }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++)
    data.fill(Math.round(Math.min(1, distances[i] / reach) * 255), i * 4, i * 4 + 4);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { texture, bounds, reach };
};

// The 1D squared distance transform of Felzenszwalb and Huttenlocher, applied in place to `count` entries
// of `values` starting at `start` and `step` apart, with samples `spacing` metres apart. Each entry becomes
// the minimum over all entries of (that entry's value + squared distance between them).
const scratch = { at: new Int32Array(0), from: new Float64Array(0), out: new Float64Array(0) };
const distanceSquared = (
  values: Float64Array,
  start: number,
  step: number,
  count: number,
  spacing: number,
) => {
  if (scratch.at.length < count) {
    scratch.at = new Int32Array(count);
    scratch.from = new Float64Array(count + 1);
    scratch.out = new Float64Array(count);
  }
  const { at, from, out } = scratch;
  const f = (i: number) => values[start + i * step];
  // The position, in cells, where the parabolas rooted at i and j intersect.
  const cross = (i: number, j: number) =>
    (f(i) + (i * spacing) ** 2 - (f(j) + (j * spacing) ** 2)) / (2 * spacing * spacing * (i - j));
  let k = -1;
  for (let q = 0; q < count; q++) {
    if (f(q) === Number.POSITIVE_INFINITY) continue;
    let s = Number.NEGATIVE_INFINITY;
    while (k >= 0) {
      s = cross(q, at[k]);
      if (s > from[k]) break;
      k--;
    }
    k++;
    at[k] = q;
    from[k] = k === 0 ? Number.NEGATIVE_INFINITY : s;
    from[k + 1] = Number.POSITIVE_INFINITY;
  }
  // No land along this line, so every entry stays infinite.
  if (k < 0) return;
  let j = 0;
  for (let q = 0; q < count; q++) {
    while (from[j + 1] < q) j++;
    out[q] = ((q - at[j]) * spacing) ** 2 + f(at[j]);
  }
  for (let q = 0; q < count; q++) values[start + q * step] = out[q];
};

const distanceToOutline = (px: number, pz: number, outline: Outline) => {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az] = outline[j];
    const [bx, bz] = outline[i];
    const lx = bx - ax;
    const lz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * lx + (pz - az) * lz) / (lx * lx + lz * lz || 1)));
    best = Math.min(best, Math.hypot(px - (ax + lx * t), pz - (az + lz * t)));
  }
  return best;
};
