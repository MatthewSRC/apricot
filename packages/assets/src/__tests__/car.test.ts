import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CAR_DIMENSIONS, createCar, createWheelGeometry, WHEEL_NAMES } from "../car";

describe("createCar", () => {
  it("has a body and four named wheels on the ground, facing +z", () => {
    const car = createCar();
    expect(car.name).toBe("Car");
    expect((car.getObjectByName("body") as THREE.Mesh).isMesh).toBe(true);
    for (const name of WHEEL_NAMES) {
      const wheel = car.getObjectByName(name) as THREE.Mesh;
      expect(wheel.position.y).toBeCloseTo(CAR_DIMENSIONS.wheelRadius);
      expect(wheel.rotation.order).toBe("YXZ");
    }
    // Front wheels at +z, left wheels at +x (the car's left when facing +z).
    expect(car.getObjectByName("wheel_fl")?.position.z).toBeGreaterThan(0);
    expect(car.getObjectByName("wheel_rl")?.position.z).toBeLessThan(0);
    expect(car.getObjectByName("wheel_fl")?.position.x).toBeGreaterThan(0);
    const box = new THREE.Box3().setFromObject(car);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.z - box.min.z).toBeCloseTo(CAR_DIMENSIONS.length + 0.18, 1);
    expect(car.userData).toEqual({ wheelRadius: 0.3, wheelBase: 1.4 });
  });

  it("shares one geometry between the wheels and one material for everything", () => {
    const car = createCar({ color: "#3366ff" });
    const meshes: THREE.Mesh[] = [];
    car.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(5);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    expect(new Set(meshes.slice(1).map((m) => m.geometry)).size).toBe(1);
    // Body colour shows up in the vertex colours.
    const colors = meshes[0].geometry.getAttribute("color");
    let blue = 0;
    for (let i = 0; i < colors.count; i++) if (colors.getZ(i) > colors.getX(i) * 3) blue++;
    expect(blue).toBeGreaterThan(colors.count / 3);
  });

  it("builds a wheel whose axle is along x", () => {
    const wheel = createWheelGeometry(0.5);
    wheel.computeBoundingBox();
    const box = wheel.boundingBox as THREE.Box3;
    expect(box.max.y).toBeCloseTo(0.5);
    expect(box.max.x).toBeLessThan(0.25);
  });
});
