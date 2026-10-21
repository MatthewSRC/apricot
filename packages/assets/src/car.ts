import { mergeColoredParts } from "@apricotjs/core";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as THREE from "three/webgpu";

export interface CarOptions {
  /** Body colour (default emoji red). */
  color?: THREE.ColorRepresentation;
  /** Window colour. */
  glass?: THREE.ColorRepresentation;
}

/** Wheel node names. In a <Vehicle>, the front wheels steer and spin and the rear wheels spin. */
export const WHEEL_NAMES = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"] as const;

/** Dimensions of the toy car, matching ArcadeVehicle's defaults. */
export const CAR_DIMENSIONS = {
  length: 2.1,
  width: 1.1,
  wheelRadius: 0.3,
  wheelBase: 1.4,
  track: 1.04,
} as const;

const at = (x: number, y: number, z: number, rotation?: THREE.Euler) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(rotation ?? new THREE.Euler()),
    new THREE.Vector3(1, 1, 1),
  );

/** One wheel with a dark tyre and a light hub, its axle along x and centred on the origin. */
export const createWheelGeometry = (radius: number = CAR_DIMENSIONS.wheelRadius) => {
  const sideways = new THREE.Euler(0, 0, Math.PI / 2);
  const tyre = new THREE.CylinderGeometry(radius, radius, radius * 0.8, 20);
  const hub = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, radius * 0.86, 14);
  const geometry = mergeColoredParts([
    { geometry: tyre, color: "#2b2d33", matrix: at(0, 0, 0, sideways) },
    { geometry: hub, color: "#d9dde3", matrix: at(0, 0, 0, sideways) },
  ]);
  tyre.dispose();
  hub.dispose();
  return geometry;
};

/**
 * An emoji-style toy car facing +z with its wheels on the ground at y = 0. The body is one
 * vertex-coloured mesh and each wheel is a separate mesh named after WHEEL_NAMES, so <Vehicle>
 * can steer and spin them. Drawn in five draw calls.
 */
export const createCar = ({ color = "#f24b3f", glass = "#bfe3ff" }: CarOptions = {}) => {
  const { wheelRadius: r, wheelBase, track } = CAR_DIMENSIONS;
  const lower = new RoundedBoxGeometry(1.1, 0.46, 2.1, 3, 0.16);
  const cabin = new RoundedBoxGeometry(0.92, 0.46, 1.08, 3, 0.18);
  const windows = new RoundedBoxGeometry(0.95, 0.27, 1.12, 2, 0.1);
  const lamp = new THREE.SphereGeometry(0.085, 10, 8);
  const bumper = new RoundedBoxGeometry(1.14, 0.13, 0.16, 2, 0.05);
  const body = mergeColoredParts([
    {
      geometry: lower,
      // Slightly darker along the bottom edge.
      color: (p) => new THREE.Color(color).multiplyScalar(p.y < 0.36 ? 0.82 : 1),
      matrix: at(0, 0.53, 0),
    },
    { geometry: cabin, color, matrix: at(0, 0.88, -0.12) },
    { geometry: windows, color: glass, matrix: at(0, 0.93, -0.12) },
    { geometry: lamp, color: "#fff4c2", matrix: at(0.36, 0.56, 1.03) },
    { geometry: lamp, color: "#fff4c2", matrix: at(-0.36, 0.56, 1.03) },
    { geometry: lamp, color: "#9e1b22", matrix: at(0.38, 0.58, -1.03) },
    { geometry: lamp, color: "#9e1b22", matrix: at(-0.38, 0.58, -1.03) },
    { geometry: bumper, color: "#3b3f46", matrix: at(0, 0.34, 1.06) },
    { geometry: bumper, color: "#3b3f46", matrix: at(0, 0.34, -1.06) },
  ]);
  for (const g of [lower, cabin, windows, lamp, bumper]) g.dispose();

  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  const car = new THREE.Group();
  car.name = "Car";
  const bodyMesh = new THREE.Mesh(body, material);
  bodyMesh.name = "body";
  car.add(bodyMesh);

  const wheel = createWheelGeometry(r);
  const positions: Record<(typeof WHEEL_NAMES)[number], [number, number]> = {
    wheel_fl: [track / 2, wheelBase / 2],
    wheel_fr: [-track / 2, wheelBase / 2],
    wheel_rl: [track / 2, -wheelBase / 2],
    wheel_rr: [-track / 2, -wheelBase / 2],
  };
  for (const name of WHEEL_NAMES) {
    const mesh = new THREE.Mesh(wheel, material);
    mesh.name = name;
    // Steering turns about y before the wheel spins about its axle.
    mesh.rotation.order = "YXZ";
    mesh.position.set(positions[name][0], r, positions[name][1]);
    car.add(mesh);
  }
  car.userData = { wheelRadius: r, wheelBase };
  return car;
};
