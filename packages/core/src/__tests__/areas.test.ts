import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  createSlabGeometry,
  insideOutline,
  keepWithin,
  type Outline,
  outlineArea,
  placedInside,
  placedTouches,
  smoothOutline,
} from "../areas";
import type { Placed } from "../placement";

// An L shape: a 4 × 4 square with its top-right quarter cut away.
const ell: Outline = [
  [0, 0],
  [4, 0],
  [4, 2],
  [2, 2],
  [2, 4],
  [0, 4],
];
const box = (x: number, z: number, turn = 0, w = 1, d = 1): Placed => ({
  x,
  z,
  turn,
  footprint: { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 },
});

describe("outlines", () => {
  it("know what is inside them, bays and all", () => {
    expect(insideOutline(1, 1, ell)).toBe(true);
    expect(insideOutline(3, 1, ell)).toBe(true);
    expect(insideOutline(3, 3, ell)).toBe(false);
    expect(insideOutline(-1, 1, ell)).toBe(false);
    expect(outlineArea(ell)).toBe(12);
  });

  it("know whether a placed thing is wholly inside, or touches them", () => {
    expect(placedInside(box(1, 1), ell)).toBe(true);
    // Across the inner corner, all its corners are inside but the cut-away part reaches in.
    expect(placedInside(box(2.4, 2.4, 0, 1.6, 1.6), ell)).toBe(false);
    // Turned, over the edge.
    expect(placedInside(box(0.6, 2, 45), ell)).toBe(false);
    expect(placedInside(box(1, 2, 0, 1, 1), ell)).toBe(true);
    // Touching from outside is not touching.
    expect(placedTouches(box(-0.5, 1), ell)).toBe(false);
    expect(placedTouches(box(-0.4, 1), ell)).toBe(true);
    expect(placedTouches(box(3, 3), ell)).toBe(false);
    // Bigger than a small outline, all round it.
    const pebble: Outline = [
      [0, 0],
      [0.2, 0],
      [0.2, 0.2],
      [0, 0.2],
    ];
    expect(placedTouches(box(0.1, 0.1, 0, 2, 2), pebble)).toBe(true);
    expect(placedTouches(box(5, 5), pebble)).toBe(false);
  });

  it("keep a thing inside, sliding along the edge, stopping where it can't go on", () => {
    // Pushed out through the bottom edge (z < 0) while moving right: slides along it.
    const slid = keepWithin(box(1.5, -0.3), ell, { x: 1, z: 0.6 }) as [number, number];
    expect(slid[0]).toBeCloseTo(1.5);
    expect(slid[1]).toBeCloseTo(0.5, 2);
    // Straight into the cut-away corner: as far as it goes.
    const stopped = keepWithin(box(3, 3), ell, { x: 3, z: 1 }) as [number, number];
    expect(stopped[0]).toBe(3);
    expect(stopped[1]).toBeCloseTo(1.5, 2);
    expect(keepWithin(box(1, 1), ell, { x: 3, z: 3 })).toEqual([1, 1]);
    // Starting outside, nowhere on the way fits.
    expect(keepWithin(box(9, 9), ell, { x: 8, z: 8 })).toBeNull();
  });

  it("round their corners into a smooth shore", () => {
    const square: Outline = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const shore = smoothOutline(square, 40);
    expect(shore).toHaveLength(40);
    // Through the corners, bulging out between them.
    expect(shore.some(([x, z]) => Math.abs(x - 1) < 0.05 && Math.abs(z + 1) < 0.05)).toBe(true);
    expect(outlineArea(shore)).toBeGreaterThan(3.5);
  });

  it("stand up as ground of their shape, with holes", () => {
    const slab = createSlabGeometry(ell, {
      height: 0.3,
      holes: [
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
        ],
      ],
    });
    slab.computeBoundingBox();
    const b = slab.boundingBox as THREE.Box3;
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(0.3);
    expect(b.min.x).toBeCloseTo(0);
    expect(b.max.x).toBeCloseTo(4);
    expect(b.min.z).toBeCloseTo(0);
    expect(b.max.z).toBeCloseTo(4);
    // The hole goes through: a ray down through its middle hits nothing.
    const mesh = new THREE.Mesh(slab);
    const hits = new THREE.Raycaster(new THREE.Vector3(1, 2, 1), new THREE.Vector3(0, -1, 0)).intersectObject(
      mesh,
    );
    expect(hits).toHaveLength(0);
    const solid = new THREE.Raycaster(
      new THREE.Vector3(3, 2, 1),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh);
    expect(solid[0]?.point.y).toBeCloseTo(0.3);
    // No bevel: flat.
    createSlabGeometry(ell, { bevel: 0 }).computeBoundingBox();
  });
});
