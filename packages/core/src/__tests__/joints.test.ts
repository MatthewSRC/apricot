import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { hingePoint, Joint } from "../joints";

const close = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
};

/** A 2 × 0.1 × 1 lid on a laptop base, centred at (0, 0.05, 0). */
const laptop = () => {
  const root = new THREE.Group();
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1));
  lid.position.set(0, 0.05, 0);
  root.add(lid);
  return { root, lid };
};

const world = (object: THREE.Object3D, local: THREE.Vector3) => {
  object.updateWorldMatrix(true, false);
  return local.clone().applyMatrix4(object.matrixWorld);
};

describe("hingePoint", () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 2, 0.5));

  it("puts named sides on the box's faces and leaves the rest at the centre", () => {
    close(hingePoint(box, "bottom-back"), 0, 0, -0.5);
    close(hingePoint(box, "top front left"), 1, 2, 0.5);
    close(hingePoint(box, "Right"), -1, 1, 0);
    close(hingePoint(box, "center"), 0, 1, 0);
    close(hingePoint(box, "centre"), 0, 1, 0);
  });

  it("names the words it knows when given one it does not", () => {
    expect(() => hingePoint(box, "bottom-sideways")).toThrow(/Unknown hinge word "sideways".*front, back/);
  });
});

describe("Joint", () => {
  it("turns a lid around its back edge", () => {
    const { lid } = laptop();
    const joint = new Joint([lid], { hinge: "bottom-back", axis: "x", range: [0, -90] });
    joint.set(1);
    // The front edge (z = +0.5 at rest) swings up above the hinge at (y 0, z -0.5).
    close(world(lid, new THREE.Vector3(0, -0.05, 0.5)), 0, 1, -0.5);
    expect(joint.current).toBe(1);
    joint.set(0);
    close(lid.position, 0, 0.05, 0);
    expect(lid.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });

  it("defaults to a 90° turn around y through the centre", () => {
    const { lid } = laptop();
    const joint = new Joint([lid]);
    joint.set(0.5);
    close(lid.position, 0, 0.05, 0);
    expect(new THREE.Euler().setFromQuaternion(lid.quaternion).y).toBeCloseTo(Math.PI / 4, 5);
  });

  it("slides a drawer along an axis, and resets", () => {
    const { lid } = laptop();
    const joint = new Joint([lid], { slide: [0, 0.4], axis: "z" });
    joint.set(0.5);
    close(lid.position, 0, 0.05, 0.2);
    joint.reset();
    close(lid.position, 0, 0.05, 0);
    expect(joint.current).toBe(0);
  });

  it("accepts an exact hinge point and axis, and moves parts with different parents together", () => {
    const root = new THREE.Group();
    const door = new THREE.Group();
    door.position.set(1, 0, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    door.add(panel);
    handle.position.set(1.4, 0, 0.1);
    root.add(door, handle);
    // Hinge at the left edge of the panel, in the door group's (the first part's parent's) space.
    const joint = new Joint([panel, handle], { hinge: [-0.5, 0, 0], axis: [0, 2, 0], range: [0, 90] });
    joint.set(1);
    // Turning +90° around y takes +x to -z: the handle, at (0.9, 0, 0.1) from the hinge (x 0.5), ends at (0.1, 0, -0.9).
    close(world(handle, new THREE.Vector3()), 0.6, 0, -0.9);
    close(world(panel, new THREE.Vector3()), 0.5, 0, -0.5);
  });

  it("works on parts without a parent or without geometry", () => {
    const loose = new THREE.Object3D();
    loose.position.set(1, 2, 3);
    const joint = new Joint([loose], { hinge: "top", range: [0, 180] });
    joint.set(1);
    close(loose.position, 1, 2, 3);
    expect(new Joint([]).current).toBe(0);
  });
});
