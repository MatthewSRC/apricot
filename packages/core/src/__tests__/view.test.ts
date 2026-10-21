import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { fitCamera, fitDistance, visibleBox } from "../view";

describe("visibleBox", () => {
  it("is the area the camera sees at the box's nearest face", () => {
    const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 100);
    camera.position.set(1, 2, 10);
    const box = visibleBox(camera, 1);
    // tan(45°) × (10 − 1) = 9 high (half), × aspect 2 = 18 wide (half).
    expect(box.min[0]).toBeCloseTo(-17);
    expect(box.max[0]).toBeCloseTo(19);
    expect(box.min[1]).toBeCloseTo(-7);
    expect(box.max[1]).toBeCloseTo(11);
    expect([box.min[2], box.max[2]]).toEqual([-1, 1]);
  });

  it("projects every point inside it onto the screen", () => {
    const camera = new THREE.PerspectiveCamera(30, 0.46, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.updateMatrixWorld();
    const { min, max } = visibleBox(camera, 0.5, 0);
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) {
          const ndc = new THREE.Vector3(x, y, z).project(camera);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1 + 1e-9);
        }
  });

  it("defaults to the plane z = 0 and survives a camera on the plane", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    const box = visibleBox(camera);
    expect(box.max[0]).toBeGreaterThan(0);
    expect(box.max[0]).toBeLessThan(1e-3);
  });
});

describe("fitDistance / fitCamera", () => {
  it("fits the tighter side, with a margin", () => {
    const camera = new THREE.PerspectiveCamera(90, 0.5, 0.1, 100); // tan(45°) = 1
    // Height 2 needs 1; width 2 at aspect 0.5 needs 2: width wins.
    expect(fitDistance(camera, 2, 2, 0)).toBeCloseTo(2);
    expect(fitDistance(camera, 2, 2)).toBeCloseTo(2.2);
    camera.aspect = 4;
    expect(fitDistance(camera, 2, 2, 0)).toBeCloseTo(1);
  });

  it("moves the camera along its line of sight and keeps the area on screen", () => {
    const camera = new THREE.PerspectiveCamera(35, 0.46, 0.1, 100);
    camera.position.set(0, 1, 3);
    fitCamera(camera, 3.37, 2.125, { margin: 0.1 });
    expect(camera.position.y / camera.position.z).toBeCloseTo(1 / 3);
    for (const [x, y] of [
      [-1.685, -1.0625],
      [1.685, 1.0625],
    ]) {
      const ndc = new THREE.Vector3(x, y, 0).project(camera);
      expect(Math.abs(ndc.x)).toBeLessThan(1);
      expect(Math.abs(ndc.y)).toBeLessThan(1);
    }
  });

  it("looks along -z from a camera sitting on its target, and supports another target", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    fitCamera(camera, 1, 1, { margin: 0 });
    expect(camera.position.x).toBe(0);
    expect(camera.position.z).toBeGreaterThan(0);
    camera.position.set(5, 0, 1);
    fitCamera(camera, 1, 1, { target: [5, 0, 0] });
    expect(camera.position.x).toBeCloseTo(5);
  });
});
