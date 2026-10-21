import * as THREE from "three/webgpu";

/** The floor area an object covers in its own space, before it is turned: its x and z extents. */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A footprint plus the height range the object spans, in its own space. */
export interface Extent extends Footprint {
  minY: number;
  maxY: number;
}

/** The floor area things must stay in: [minX, minZ, maxX, maxZ]. */
export type PlacementBounds = readonly [number, number, number, number];

const NO_FOOTPRINT = "apricot:noFootprint";

const box = new THREE.Box3();
const part = new THREE.Box3();
const toRoot = new THREE.Matrix4();
const meshToRoot = new THREE.Matrix4();

/**
 * Excludes `object` and its descendants from footprints. Use it for parts
 * that do not stand on the floor, such as a lamp's glow or overhanging
 * leaves. Pass `leave = false` to include it again.
 */
export const leaveOutOfFootprint = (object: THREE.Object3D, leave = true) => {
  if (leave) object.userData[NO_FOOTPRINT] = true;
  else delete object.userData[NO_FOOTPRINT];
};

// The bounding box of `mesh` in its own space, or null when it has nothing to measure.
const meshBox = (mesh: THREE.Mesh): THREE.Box3 | null => {
  const instanced = mesh as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    if (instanced.count === 0) return null;
    instanced.computeBoundingBox();
    part.copy(instanced.boundingBox as THREE.Box3);
  } else {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    part.copy(mesh.geometry.boundingBox as THREE.Box3);
  }
  return part.isEmpty() ? null : part;
};

/**
 * The extent of every mesh under `root`, in `root`'s own space (ignoring
 * its position and turn). Returns null when there is nothing to measure yet,
 * such as a model still loading. Objects marked with leaveOutOfFootprint
 * are skipped.
 */
export const footprintOf = (root: THREE.Object3D): Extent | null => {
  root.updateWorldMatrix(true, true);
  const inverse = toRoot.copy(root.matrixWorld).invert();
  box.makeEmpty();
  const visit = (o: THREE.Object3D) => {
    if (o.userData[NO_FOOTPRINT]) return;
    for (const child of o.children) visit(child);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const local = meshBox(mesh);
    if (!local) return;
    // Transform straight into root space. Going through world space would loosen the box of a turned root.
    box.union(local.applyMatrix4(meshToRoot.multiplyMatrices(inverse, mesh.matrixWorld)));
  };
  visit(root);
  if (box.isEmpty()) return null;
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
};

/** The axis-aligned floor area `footprint` covers after turning it `turn` degrees around y. */
export const turnedFootprint = (footprint: Footprint, turn: number): Footprint => {
  const a = THREE.MathUtils.degToRad(turn);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const x of [footprint.minX, footprint.maxX]) {
    for (const z of [footprint.minZ, footprint.maxZ]) {
      // Rotation around +y, matching three.js.
      const tx = x * cos + z * sin;
      const tz = -x * sin + z * cos;
      minX = Math.min(minX, tx);
      maxX = Math.max(maxX, tx);
      minZ = Math.min(minZ, tz);
      maxZ = Math.max(maxZ, tz);
    }
  }
  return { minX, maxX, minZ, maxZ };
};

/** Rounds `value` to the nearest multiple of `step`. A `step` of 0 leaves it unchanged. */
export const snap = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value);

/** Snaps a turn in degrees to `step` and wraps it into [0, 360). */
export const snapTurn = (turn: number, step: number) => {
  const snapped = snap(turn, step);
  return ((snapped % 360) + 360) % 360;
};

/**
 * Moves an object at (x, z) covering `footprint` (already turned) the
 * least distance that keeps it inside `bounds`. An object larger than the
 * bounds is centred in them.
 */
export const keepInside = (
  x: number,
  z: number,
  footprint: Footprint,
  bounds: PlacementBounds,
): [number, number] => {
  const [minX, minZ, maxX, maxZ] = bounds;
  const place = (value: number, low: number, high: number, min: number, max: number) =>
    high - low > max - min
      ? (min + max) / 2 - (low + high) / 2
      : Math.min(Math.max(value, min - low), max - high);
  return [
    place(x, footprint.minX, footprint.maxX, minX, maxX),
    place(z, footprint.minZ, footprint.maxZ, minZ, maxZ),
  ];
};
