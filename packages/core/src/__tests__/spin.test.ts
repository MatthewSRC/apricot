import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { normalizeAxis, stepSpin } from "../spin";

describe("normalizeAxis", () => {
  it("normalises", () => {
    expect(normalizeAxis([0, 2, 0])).toEqual([0, 1, 0]);
    const [x, y, z] = normalizeAxis([1, 1, 0]);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
  });
  it("falls back to +Y for a zero axis", () => {
    expect(normalizeAxis([0, 0, 0])).toEqual([0, 1, 0]);
  });
});

describe("stepSpin", () => {
  it("rotates by speed × delta around the axis", () => {
    const object = new THREE.Object3D();
    expect(stepSpin(object, Math.PI, [0, 1, 0], 0.5)).toBe(true);
    expect(object.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("matches rotateOnAxis for an arbitrary axis", () => {
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    stepSpin(a, 2, [1, 2, 3], 0.1);
    b.rotateOnAxis(new THREE.Vector3(1, 2, 3).normalize(), 0.2);
    expect(a.quaternion.angleTo(b.quaternion)).toBeCloseTo(0);
  });

  it("reports still when speed is zero and does not rotate on a zero delta", () => {
    const object = new THREE.Object3D();
    expect(stepSpin(object, 0, [0, 1, 0], 1)).toBe(false);
    expect(stepSpin(object, 1, [0, 1, 0], 0)).toBe(true);
    expect(object.rotation.y).toBe(0);
  });
});
