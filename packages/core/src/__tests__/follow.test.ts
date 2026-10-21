import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { FollowRig } from "../follow";

describe("FollowRig", () => {
  it("starts behind and above the target, looking ahead of it", () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Object3D();
    target.position.set(2, 0, 3);
    const rig = new FollowRig({ distance: 5, height: 2, lookAhead: [3, 0] });
    expect(rig.update(camera, target, 1 / 60)).toBe(false);
    expect(camera.position.toArray()).toEqual([2, 2, -2]);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    expect(forward.z).toBeGreaterThan(0.8);
  });

  it("eases after the target turns and moves, and settles", () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Object3D();
    const rig = new FollowRig({ distance: 5, height: 2, stiffness: 5 });
    rig.update(camera, target, 1 / 60);
    target.rotation.y = Math.PI / 2; // now facing +x
    target.position.set(10, 0, 0);
    expect(rig.update(camera, target, 1 / 60)).toBe(true);
    expect(camera.position.x).toBeLessThan(5);
    for (let i = 0; i < 600; i++) rig.update(camera, target, 1 / 60);
    expect(camera.position.x).toBeCloseTo(5, 3);
    expect(camera.position.z).toBeCloseTo(0, 3);
    expect(rig.update(camera, target, 1 / 60)).toBe(false);
  });

  it("ignores pitch and copes with a target facing straight up; snap() jumps", () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Object3D();
    target.rotation.x = -Math.PI / 2; // +z now points up
    const rig = new FollowRig({ distance: 4, height: 1 });
    rig.update(camera, target, 1 / 60);
    expect(camera.position.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -4]);
    target.rotation.x = 0;
    target.position.set(0, 0, 50);
    rig.snap();
    rig.update(camera, target, 1 / 60);
    expect(camera.position.z).toBeCloseTo(46);
  });
});
