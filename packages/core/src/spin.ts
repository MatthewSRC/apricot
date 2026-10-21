import * as THREE from "three/webgpu";

export type Vec3 = readonly [number, number, number];

/** Normalises an axis. A zero axis becomes +y. */
export const normalizeAxis = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 1, 0] : [x / length, y / length, z / length];
};

const axisScratch = new THREE.Vector3();

/**
 * Rotates `object` by `speed` radians per second around `axis` (object space)
 * for `delta` seconds. Returns true while it is moving.
 */
export const stepSpin = (object: THREE.Object3D, speed: number, axis: Vec3, delta: number) => {
  if (speed === 0) return false;
  if (delta > 0) object.rotateOnAxis(axisScratch.set(...normalizeAxis(axis)), speed * delta);
  return true;
};
