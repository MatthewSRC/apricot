import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { PressRouter } from "../press";

const setup = () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const red = new THREE.MeshBasicNodeMaterial({ name: "red" });
  const blue = new THREE.MeshBasicNodeMaterial({ name: "blue" });
  const near = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), red);
  near.position.z = 2;
  const far = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), blue);
  const a = new THREE.Group();
  a.add(near);
  const b = new THREE.Group();
  b.add(far);
  return { camera, a, b, near, far, red, blue };
};

describe("PressRouter", () => {
  it("routes a tap to the owner of the nearest mesh", () => {
    const { camera, a, b, near } = setup();
    const router = new PressRouter();
    const onA = vi.fn();
    const onB = vi.fn();
    router.add(a, onA);
    router.add(b, onB);
    const hit = router.press(camera, 50, 50, 100, 100);
    expect(hit?.mesh).toBe(near);
    expect(onA).toHaveBeenCalledWith(expect.objectContaining({ mesh: near, materialIndex: 0 }));
    expect(onB).not.toHaveBeenCalled();
    // Off-centre the small box is missed and the big one is hit.
    router.press(camera, 30, 50, 100, 100);
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it("skips hidden meshes and reports misses", () => {
    const { camera, a, b, near, far } = setup();
    const router = new PressRouter();
    const onB = vi.fn();
    router.add(a, vi.fn());
    router.add(b, onB);
    near.visible = false;
    expect(router.press(camera, 50, 50, 100, 100)?.mesh).toBe(far);
    a.visible = true;
    expect(router.press(camera, 1, 1, 100, 100)).toBeNull();
    expect(router.hitTest(camera, 50, 50, 0, 100)).toBeNull();
  });

  it("does nothing without listeners, and removes them", () => {
    const { camera, a } = setup();
    const router = new PressRouter();
    expect(router.active).toBe(false);
    expect(router.press(camera, 50, 50, 100, 100)).toBeNull();
    const handler = vi.fn();
    const remove = router.add(a, handler);
    const other = vi.fn();
    const removeOther = router.add(a, other);
    // Every handler on an object hears its taps.
    router.press(camera, 50, 50, 100, 100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    remove();
    expect(router.active).toBe(true);
    removeOther();
    expect(router.active).toBe(false);
    removeOther();
  });

  it("reports the material of the face hit on multi-material meshes", () => {
    const { camera, red, blue } = setup();
    // BoxGeometry groups: +x, -x, +y, -y, +z (index 4), -z.
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [red, red, red, red, blue, red]);
    const router = new PressRouter();
    const handler = vi.fn();
    router.add(box, handler);
    const hit = router.press(camera, 50, 50, 100, 100);
    expect(hit?.materialIndex).toBe(4);
    expect(hit?.material).toBe(blue);
    expect(handler).toHaveBeenCalled();
  });

  it("hit-tests listeners that are not meshes' ancestors without calling anyone", () => {
    const { camera, near } = setup();
    const router = new PressRouter();
    expect(router.hitTest(camera, 50, 50, 100, 100, [near])?.mesh).toBe(near);
  });

  it("tells miss listeners about taps on nothing that listens", () => {
    const router = new PressRouter();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    const missed = vi.fn();
    const remove = router.addMiss(missed);
    expect(router.active).toBe(true);
    // Nothing registered: every tap misses.
    router.press(camera, 50, 50, 100, 100);
    expect(missed).toHaveBeenCalledTimes(1);
    const box = new THREE.Mesh(new THREE.BoxGeometry());
    new THREE.Scene().add(box);
    const hit = vi.fn();
    router.add(box, hit);
    router.press(camera, 50, 50, 100, 100);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(missed).toHaveBeenCalledTimes(1);
    router.press(camera, 1, 1, 100, 100);
    expect(missed).toHaveBeenCalledTimes(2);
    remove();
    router.press(camera, 1, 1, 100, 100);
    expect(missed).toHaveBeenCalledTimes(2);
  });
});
