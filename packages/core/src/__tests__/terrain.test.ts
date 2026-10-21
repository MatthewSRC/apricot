import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createTerrainGeometry, createTerrainWaterGeometry } from "../terrain";

// A beach: sand at 0.2 for x > 0, sloping down to the sea floor at -0.4 for x < -1.
const beach = (x: number) => (x > 0 ? 0.2 : x < -1 ? -0.4 : 0.2 + 0.6 * x);

describe("terrain", () => {
  it("is a tile of ground at its height, cut square with sides down to the base", () => {
    const ground = createTerrainGeometry(4, 2, beach, { spacing: 0.5, base: -1 });
    ground.computeBoundingBox();
    const b = ground.boundingBox as THREE.Box3;
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]).toEqual(
      [-2, 2, -1, 0.2, -1, 1].map((v) => expect.closeTo(v)),
    );
    // The top: 9 × 5 points on the ground, facing up; then the sides, two points (top and base) at each.
    const position = ground.getAttribute("position");
    const normal = ground.getAttribute("normal");
    expect(position.count).toBe(9 * 5 + 2 * 2 * (9 + 5));
    for (let i = 0; i < 9 * 5; i++) {
      expect(position.getY(i)).toBeCloseTo(beach(position.getX(i)));
      expect(normal.getY(i)).toBeGreaterThan(0.5);
    }
    // The front side faces +z, the left one -x.
    const front = 9 * 5;
    expect(normal.getZ(front)).toBeCloseTo(1);
    expect(normal.getX(front + 2 * 9 * 2 + 2 * 5)).toBeCloseTo(-1);
  });

  it("is coloured point by point, with layers in its sides", () => {
    const ground = createTerrainGeometry(2, 2, beach, {
      spacing: 1,
      color: (_x, _z, y) => (y > 0 ? "#ffffff" : "#000000"),
      sides: (y) => (y > -0.5 ? "#ff0000" : "#0000ff"),
    });
    const color = ground.getAttribute("color");
    const position = ground.getAttribute("position");
    const red = new THREE.Color("#ff0000");
    const blue = new THREE.Color("#0000ff");
    for (let i = 0; i < 9; i++) expect(color.getX(i)).toBe(position.getY(i) > 0 ? 1 : 0);
    // Below the lowest point by 0.2 by default; each side point's top in the top layer, its base in the bottom one.
    expect(position.getY(10)).toBeCloseTo(-0.6);
    expect([color.getX(9), color.getZ(9)]).toEqual([red.r, red.b]);
    expect([color.getX(10), color.getZ(10)]).toEqual([blue.r, blue.b]);
    // Plain white without colours: the material's.
    expect(createTerrainGeometry(1, 1, beach).getAttribute("color").getX(0)).toBe(1);
  });

  it("shows the water's depth in the cut wherever the ground is under it", () => {
    const glass = createTerrainWaterGeometry(4, 2, beach, 0, {
      spacing: 0.5,
      top: "#ffffff",
      deep: "#000000",
      fade: 0.4,
    });
    const position = glass.getAttribute("position");
    const color = glass.getAttribute("color");
    // Along the front: each point's surface at the level, its foot on the ground (or the level, ashore).
    for (let i = 0; i < 9; i++) {
      const x = position.getX(i * 2);
      expect(position.getY(i * 2)).toBe(0);
      expect(position.getY(i * 2 + 1)).toBeCloseTo(Math.min(0, beach(x)));
      expect(color.getX(i * 2)).toBe(1);
    }
    // At the sea floor, 0.4 m down: all deep.
    expect(color.getX(1)).toBeCloseTo(0);
  });
});
