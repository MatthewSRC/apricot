import * as THREE from "three/webgpu";
import { DEG } from "./maths";

/** Space covered by UI on each side of the canvas, in points. The subject is framed in the rest. */
export interface Inset {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export const NO_INSET: Required<Inset> = { top: 0, bottom: 0, left: 0, right: 0 };

/** Interpolates each edge from `from` to `to` by `t`. */
export const lerpInset = (from: Required<Inset>, to: Required<Inset>, t: number): Required<Inset> => {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    top: lerp(from.top, to.top),
    bottom: lerp(from.bottom, to.bottom),
    left: lerp(from.left, to.left),
    right: lerp(from.right, to.right),
  };
};

/**
 * What the camera fits in frame:
 * - `"box"` (default): the subject's whole bounding box.
 * - `"footprint"`: the subject's floor plan only (x and z), so a room with
 *   tall walls frames the same as a flat island of the same size.
 * - `{ footprint: box }`: the floor plan of `box`, such as the base the
 *   subject stands on. Parts that reach past it are ignored.
 * - `[width, height, depth]` in metres: a box of that size standing where the
 *   subject stands, so every subject is framed at one scale.
 */
export type CameraFit =
  | "box"
  | "footprint"
  | { readonly footprint: THREE.Box3 }
  | readonly [number, number, number];

/** Camera and screen settings for fitBoxDistance. */
export interface FitOptions {
  /** Degrees. */
  azimuth: number;
  /** Degrees. */
  elevation: number;
  /** The point looked at (default: the box's centre). */
  target?: THREE.Vector3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Canvas width in points. Only the aspect ratio and the insets relative to it matter. */
  width: number;
  /** Canvas height in points. */
  height: number;
  inset?: Inset;
  /** Extra room around the box, as a fraction (default 0.1). */
  margin?: number;
}

/** Unit vectors for a camera at `azimuth`/`elevation` degrees: towards the camera, its right, and its up. */
export const cameraBasis = (azimuth: number, elevation: number) => {
  const a = azimuth * DEG;
  const e = elevation * DEG;
  const back = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  return { back, right, up };
};

/**
 * The distance from the target at which a camera at (azimuth, elevation)
 * fits `box` in the part of the screen not covered by `inset`. CameraRig
 * frames its views with this; use it directly for custom framing, such as
 * one fixed distance for several subjects.
 */
export const fitBoxDistance = (box: THREE.Box3, options: FitOptions) => {
  const { azimuth, elevation, fov, width, height, inset = {}, margin = 0.1 } = options;
  const target = options.target ?? box.getCenter(new THREE.Vector3());
  const { top = 0, bottom = 0, left = 0, right = 0 } = inset;
  const freeWidth = Math.max(1, width - left - right);
  const freeHeight = Math.max(1, height - top - bottom);
  const grow = 1 + margin;
  const tanV = (Math.tan((fov / 2) * DEG) * (freeHeight / height)) / grow;
  const tanH = (Math.tan((fov / 2) * DEG) * (width / height) * (freeWidth / width)) / grow;
  const { back, right: across, up } = cameraBasis(azimuth, elevation);
  const { min, max } = box;
  let distance = 0;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).sub(target);
    const depth = corner.dot(back);
    // A corner is in view when its offset across the view is at most tan(half fov) times its depth from the camera.
    distance = Math.max(
      distance,
      Math.abs(corner.dot(across)) / tanH + depth,
      Math.abs(corner.dot(up)) / tanV + depth,
    );
  }
  return distance;
};

/** The box to fit for `subject` under `fit` (see CameraFit). */
export const boxToFit = (subject: THREE.Box3, fit: CameraFit): THREE.Box3 => {
  if (fit === "box") return subject;
  if (fit === "footprint")
    return new THREE.Box3(
      subject.min.clone(),
      new THREE.Vector3(subject.max.x, subject.min.y, subject.max.z),
    );
  if ("footprint" in fit) {
    const floor = fit.footprint;
    if (floor.isEmpty()) return subject;
    return new THREE.Box3(
      new THREE.Vector3(floor.min.x, subject.min.y, floor.min.z),
      new THREE.Vector3(floor.max.x, subject.min.y, floor.max.z),
    );
  }
  const [width, height, depth] = fit;
  const centre = subject.getCenter(new THREE.Vector3());
  return new THREE.Box3(
    new THREE.Vector3(centre.x - width / 2, subject.min.y, centre.z - depth / 2),
    new THREE.Vector3(centre.x + width / 2, subject.min.y + height, centre.z + depth / 2),
  );
};
