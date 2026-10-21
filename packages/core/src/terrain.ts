import * as THREE from "three/webgpu";

/** The ground's height at (x, z), in metres. */
export type HeightAt = (x: number, z: number) => number;

export interface TerrainOptions {
  /** Largest spacing between grid points in metres (default 0.1). */
  spacing?: number;
  /** The y the sides reach down to (default: 0.2 below the lowest point). */
  base?: number;
  /** The top's colour at each point (default white, which shows the material's colour). */
  color?: (x: number, z: number, y: number) => THREE.ColorRepresentation;
  /** The sides' colour at each height, for showing layers in the cut (default: the top's colour at that edge). */
  sides?: (y: number) => THREE.ColorRepresentation;
}

// The number of grid intervals along `length` so that none is longer than `spacing`.
const steps = (length: number, spacing: number) => Math.max(1, Math.ceil(length / spacing));

// Triangles for a vertical strip whose vertices alternate top and bottom from `start`, for `points` points.
const pushStrip = (index: number[], start: number, points: number, outward: boolean) => {
  for (let i = 0; i < points - 1; i++) {
    const a = start + i * 2;
    if (outward) index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    else index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
};

/**
 * A rectangular block of ground, `width` × `depth` and centred on the
 * origin, like a diorama tile. Its top follows heightAt(x, z) and its edges
 * are cut square, with sides down to `base`. Colours are per vertex, so the
 * top can shade by height and the sides can show layers.
 */
export const createTerrainGeometry = (
  width: number,
  depth: number,
  heightAt: HeightAt,
  { spacing = 0.1, base, color, sides }: TerrainOptions = {},
) => {
  const nx = steps(width, spacing);
  const nz = steps(depth, spacing);
  const heights: number[] = [];
  let lowest = Number.POSITIVE_INFINITY;
  for (let row = 0; row <= nz; row++)
    for (let col = 0; col <= nx; col++) {
      const y = heightAt(-width / 2 + (col / nx) * width, -depth / 2 + (row / nz) * depth);
      heights.push(y);
      lowest = Math.min(lowest, y);
    }
  const bottom = base ?? lowest - 0.2;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const paint = new THREE.Color();
  const topColor = (x: number, z: number, y: number) =>
    color ? paint.set(color(x, z, y)) : paint.setRGB(1, 1, 1);
  // The top is a grid with two triangles per cell.
  for (let row = 0; row <= nz; row++)
    for (let col = 0; col <= nx; col++) {
      const x = -width / 2 + (col / nx) * width;
      const z = -depth / 2 + (row / nz) * depth;
      const y = heights[row * (nx + 1) + col];
      positions.push(x, y, z);
      const c = topColor(x, z, y);
      colors.push(c.r, c.g, c.b);
    }
  for (let row = 0; row < nz; row++)
    for (let col = 0; col < nx; col++) {
      const a = row * (nx + 1) + col;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  // Each side is a strip from the top's edge down to the bottom, facing out.
  const side = (points: [number, number, number][], outward: boolean) => {
    const start = positions.length / 3;
    for (const [x, y, z] of points) {
      const top = sides ? paint.set(sides(y)) : topColor(x, z, y);
      positions.push(x, y, z);
      colors.push(top.r, top.g, top.b);
      const under = sides ? paint.set(sides(bottom)) : topColor(x, z, y);
      positions.push(x, bottom, z);
      colors.push(under.r, under.g, under.b);
    }
    pushStrip(index, start, points.length, outward);
  };
  const at = (col: number, row: number): [number, number, number] => [
    -width / 2 + (col / nx) * width,
    heights[row * (nx + 1) + col],
    -depth / 2 + (row / nz) * depth,
  ];
  const alongRow = (row: number) => Array.from({ length: nx + 1 }, (_, col) => at(col, row));
  const alongCol = (col: number) => Array.from({ length: nz + 1 }, (_, row) => at(col, row));
  side(alongRow(nz), true); // front (+z)
  side(alongRow(0), false); // back (-z)
  side(alongCol(nx), false); // right (+x)
  side(alongCol(0), true); // left (-x)
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * Water walls for the edges of a terrain tile. Wherever the ground at an
 * edge is below `level`, a wall runs from the ground up to the water
 * surface, so the cut shows the water's depth. Vertex colours shade from
 * `top` at the surface to `deep` at `fade` metres down.
 */
export const createTerrainWaterGeometry = (
  width: number,
  depth: number,
  heightAt: HeightAt,
  level: number,
  {
    spacing = 0.1,
    top = "#7fe3e0",
    deep = "#1a7fc0",
    fade = 1,
  }: {
    spacing?: number;
    top?: THREE.ColorRepresentation;
    deep?: THREE.ColorRepresentation;
    /** Depth in metres at which the colour reaches `deep` (default 1). */
    fade?: number;
  } = {},
) => {
  const nx = steps(width, spacing);
  const nz = steps(depth, spacing);
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const surface = new THREE.Color(top);
  const bottom = new THREE.Color(deep);
  const shade = new THREE.Color();
  const side = (points: [number, number][], outward: boolean) => {
    const start = positions.length / 3;
    for (const [x, z] of points) {
      const ground = Math.min(level, heightAt(x, z));
      positions.push(x, level, z, x, ground, z);
      colors.push(surface.r, surface.g, surface.b);
      shade.copy(surface).lerp(bottom, Math.min(1, (level - ground) / fade));
      colors.push(shade.r, shade.g, shade.b);
    }
    pushStrip(index, start, points.length, outward);
  };
  const x = (col: number) => -width / 2 + (col / nx) * width;
  const z = (row: number) => -depth / 2 + (row / nz) * depth;
  side(
    Array.from({ length: nx + 1 }, (_, col) => [x(col), depth / 2]),
    true,
  );
  side(
    Array.from({ length: nx + 1 }, (_, col) => [x(col), -depth / 2]),
    false,
  );
  side(
    Array.from({ length: nz + 1 }, (_, row) => [width / 2, z(row)]),
    false,
  );
  side(
    Array.from({ length: nz + 1 }, (_, row) => [-width / 2, z(row)]),
    true,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};
