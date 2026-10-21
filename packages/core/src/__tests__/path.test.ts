import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Path } from "../path";

describe("Path", () => {
  const straight = () =>
    new Path([
      [0, 0, 0],
      [0, 0, 100],
    ]);

  it("measures in metres along the curve", () => {
    const path = straight();
    expect(path.length).toBeCloseTo(100, 3);
    expect(path.pointAt(25).z).toBeCloseTo(25, 3);
    expect(
      path
        .tangentAt(25)
        .toArray()
        .map((v) => Math.round(v)),
    ).toEqual([0, 0, 1]);
    // Off the ends: clamped.
    expect(path.pointAt(-5).z).toBeCloseTo(0, 5);
    expect(path.pointAt(500).z).toBeCloseTo(100, 3);
  });

  it("keeps distances even on unevenly spaced points", () => {
    const path = new Path([
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, 100],
    ]);
    expect(path.pointAt(50).z).toBeCloseTo(50, 0);
  });

  it("wraps around closed paths", () => {
    const ring = new Path(
      [
        [10, 0, 0],
        [0, 0, 10],
        [-10, 0, 0],
        [0, 0, -10],
      ],
      { closed: true },
    );
    expect(ring.closed).toBe(true);
    expect(ring.length).toBeGreaterThan(55); // about 2πr for r = 10
    expect(ring.pointAt(ring.length + 1).distanceTo(ring.pointAt(1))).toBeCloseTo(0, 3);
    expect(ring.clamp(-1)).toBeCloseTo(ring.length - 1);
  });

  it("places objects facing along the path, or backwards", () => {
    const path = new Path([
      [0, 0, 0],
      [100, 0, 0],
    ]);
    const car = new THREE.Object3D();
    path.place(car, 40);
    expect(car.position.x).toBeCloseTo(40, 3);
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    expect(ahead.x).toBeCloseTo(1, 5);
    path.place(car, 40, -1);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion).x).toBeCloseTo(-1, 5);
  });

  it("spaces posts evenly and finds the distance nearest to a point", () => {
    const path = straight();
    expect(path.every(25)).toHaveLength(5);
    expect(path.every(30, 10)).toEqual([10, 40, 70, 100]);
    expect(() => path.every(0)).toThrow(/positive/);
    expect(path.distanceTo([3, 0, 60])).toBeCloseTo(60, 0);
  });

  it("needs two points", () => {
    expect(() => new Path([[0, 0, 0]])).toThrow(/two points/);
  });
});
