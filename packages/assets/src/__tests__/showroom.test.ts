import { ClipPlayer, Joint, selectParts, selectSlots } from "@apricotjs/core";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  createLaptop,
  createLaptopAnimation,
  createSedan,
  createStudioFloor,
  LAPTOP_DIMENSIONS,
  SEDAN_DIMENSIONS,
} from "../showroom";

const boundsOf = (object: THREE.Object3D) => {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
};

describe("sedan", () => {
  it("is car-sized, on the ground, facing +z", () => {
    const box = boundsOf(createSedan());
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(size.z - SEDAN_DIMENSIONS.length).toBeLessThan(0.1);
    expect(size.x).toBeLessThan(SEDAN_DIMENSIONS.width + 0.1);
    expect(size.y).toBeCloseTo(SEDAN_DIMENSIONS.height, 1);
  });

  it("names parts and materials in Italian, selectable by name", () => {
    const car = createSedan();
    expect(selectParts(car, "porta_*").map((p) => p.name)).toEqual([
      "porta_ant_sx",
      "porta_ant_dx",
      "porta_post_sx",
      "porta_post_dx",
    ]);
    expect(selectParts(car, "ruota_*")).toHaveLength(4);
    // Paint is on the body, hood, trunk, roof and four door panels.
    expect(selectSlots(car, "material:vernice")).toHaveLength(8);
    expect(selectSlots(car, "material:vetro")).toHaveLength(5);
  });

  it("opens its doors outwards around the front edge, and its hood upwards", () => {
    const car = createSedan();
    const [left] = selectParts(car, "porta_ant_sx");
    const [right] = selectParts(car, "porta_ant_dx");
    const leftBefore = boundsOf(left);
    new Joint([left], { hinge: "front", axis: "y", range: [0, -65] }).set(1);
    new Joint([right], { hinge: "front", axis: "y", range: [0, 65] }).set(1);
    expect(boundsOf(left).max.x).toBeGreaterThan(leftBefore.max.x + 0.5);
    expect(boundsOf(right).min.x).toBeLessThan(-leftBefore.max.x - 0.5);
    const [hood] = selectParts(car, "cofano");
    const hoodBefore = boundsOf(hood);
    new Joint([hood], { hinge: "back", axis: "x", range: [0, -40] }).set(1);
    expect(boundsOf(hood).max.y).toBeGreaterThan(hoodBefore.max.y + 0.5);
  });
});

describe("laptop", () => {
  it("is closed at rest, with the lid's origin on its hinge", () => {
    const laptop = createLaptop();
    const lid = laptop.getObjectByName("lid") as THREE.Object3D;
    expect(lid.position.z).toBeCloseTo(-LAPTOP_DIMENSIONS.depth / 2);
    expect(boundsOf(laptop).max.y).toBeLessThan(0.25);
  });

  it("opens with its animation, or with a joint", () => {
    const laptop = createLaptop();
    const lid = laptop.getObjectByName("lid") as THREE.Object3D;
    const player = new ClipPlayer(laptop, [createLaptopAnimation()]);
    player.seek("LidOpen", 1);
    expect(boundsOf(lid).max.y).toBeGreaterThan(1.8);
    player.seek("LidOpen", 0);
    expect(boundsOf(lid).max.y).toBeLessThan(0.25);
    new Joint([lid], { hinge: "bottom-back", axis: "x", range: [0, -110] }).set(1);
    expect(boundsOf(lid).max.y).toBeGreaterThan(1.8);
  });
});

describe("studio floor", () => {
  it("is a flat disc on y = 0", () => {
    const floor = createStudioFloor({ radius: 5 });
    const box = boundsOf(floor);
    expect(box.max.y).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(5);
    expect((floor.material as THREE.MeshBasicNodeMaterial).colorNode).toBeTruthy();
  });
});
