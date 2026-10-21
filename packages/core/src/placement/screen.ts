import * as THREE from "three/webgpu";
import type { TouchPoint } from "../rig/orbit";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plane = new THREE.Plane();
const up = new THREE.Vector3(0, 1, 0);

/**
 * The line of sight through view point (x, y), in points from the top left
 * of a `width` × `height` view. The returned ray is shared and is
 * overwritten by the next call.
 */
export const rayThrough = (camera: THREE.Camera, x: number, y: number, width: number, height: number) => {
  pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray;
};

/**
 * Where the line of sight through view point (x, y) meets the level floor
 * at height `level`. (x, y) is in points from the top left of a `width` ×
 * `height` view. Use it to drag something along the floor. Returns null
 * when the line misses the floor or meets it beyond the camera's far plane.
 */
export const floorPoint = (
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number,
  level = 0,
  out = new THREE.Vector3(),
): THREE.Vector3 | null => {
  if (width <= 0 || height <= 0) return null;
  const ray = rayThrough(camera, x, y, width, height);
  plane.set(up, -level);
  const hit = ray.intersectPlane(plane, out);
  // A hit that far away is nearly along the floor; dragging there would fling the object off.
  if (!hit || hit.distanceTo(ray.origin) > (camera as THREE.PerspectiveCamera).far) return null;
  return hit;
};

/** The angle in degrees of the line from the first finger to the second (0 with fewer than two). */
export const fingerAngle = (points: readonly TouchPoint[]) =>
  points.length < 2
    ? 0
    : THREE.MathUtils.radToDeg(Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x));

/** How far two fingers twisted from `from` to `to`, in degrees from -180 to 180. Clockwise on screen is positive. */
export const twist = (from: readonly TouchPoint[], to: readonly TouchPoint[]) => {
  const delta = fingerAngle(to) - fingerAngle(from);
  return ((((delta + 180) % 360) + 360) % 360) - 180;
};
