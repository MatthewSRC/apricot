import * as THREE from "three/webgpu";
import type { Bounds } from "./physics";

/**
 * The box of world space the camera sees, `depth` deep on each side of the
 * plane z = `z`. Sized at the box's nearest face, so anything inside it is on
 * screen. Assumes the camera looks straight down -z (the default camera).
 */
export const visibleBox = (camera: THREE.PerspectiveCamera, depth = 0, z = 0): Bounds => {
  const distance = Math.max(camera.position.z - (z + depth), 1e-6);
  const halfHeight = Math.tan(((camera.fov / 2) * Math.PI) / 180) * distance;
  const halfWidth = halfHeight * camera.aspect;
  const { x, y } = camera.position;
  return {
    min: [x - halfWidth, y - halfHeight, z - depth],
    max: [x + halfWidth, y + halfHeight, z + depth],
  };
};

/**
 * How far from its target `camera` must be for a `width` × `height` area,
 * facing it, to fill the view with `margin` (a fraction) to spare on the
 * tighter side.
 */
export const fitDistance = (camera: THREE.PerspectiveCamera, width: number, height: number, margin = 0.1) => {
  const halfTan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const forHeight = height / 2 / halfTan;
  const forWidth = width / 2 / (halfTan * camera.aspect);
  return Math.max(forHeight, forWidth) * (1 + margin);
};

/**
 * Moves `camera` along its line of sight to `target` so the area fits
 * (see fitDistance), keeping its viewing direction.
 */
export const fitCamera = (
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  { margin = 0.1, target = [0, 0, 0] as readonly [number, number, number] } = {},
) => {
  const [x, y, z] = target;
  const away = camera.position.clone().sub(new THREE.Vector3(x, y, z));
  // A camera sitting on its target looks down -z.
  if (away.lengthSq() === 0) away.set(0, 0, 1);
  away.normalize().multiplyScalar(fitDistance(camera, width, height, margin));
  camera.position.set(x + away.x, y + away.y, z + away.z);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld();
};
