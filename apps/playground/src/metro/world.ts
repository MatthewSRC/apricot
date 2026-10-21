import { type ColoredPart, mergeColoredParts, type Path, seededRandom } from "@apricotjs/core";
import * as THREE from "three/webgpu";

// Custom geometry for the Metro line scene: a viaduct deck swept along the line, rails, and buildings
// merged into one mesh.

/** Height of the viaduct deck. */
export const DECK = 9;

/**
 * Sweeps a cross-section along `path`, kept level without banking or twisting.
 *
 * @param profile A closed outline of [across, up] points in metres. `across` is measured to the left of
 * the direction of travel.
 */
export const sweep = (path: Path, profile: readonly (readonly [number, number])[], step = 4, lift = 0) => {
  const distances = path.every(step);
  if (distances[distances.length - 1] < path.length) distances.push(path.length);
  const n = profile.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  for (const d of distances) {
    path.pointAt(d, point);
    path.tangentAt(d, tangent);
    const left = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    for (const [across, up] of profile) {
      positions.push(point.x + left.x * across, point.y + lift + up, point.z + left.z * across);
    }
  }
  for (let i = 0; i < distances.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = a + n;
      const e = b + n;
      indices.push(a, c, b, b, c, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Unindexed vertices keep the deck's edges crisp.
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
};

/** A deck slab with two low parapets along `path`, at deck height. */
export const createDeck = (path: Path) =>
  sweep(
    path,
    [
      [-4.5, -1],
      [-4.5, 0.9],
      [-4.1, 0.9],
      [-4.1, 0],
      [4.1, 0],
      [4.1, 0.9],
      [4.5, 0.9],
      [4.5, -1],
    ],
    4,
    DECK,
  );

/** Two rails along the deck as thin tubes. */
export const createRails = (path: Path) => {
  const parts = [-0.75, 0.75].map((side) => {
    const points = path.every(6).map((d) => {
      const p = path.pointAt(d);
      const t = path.tangentAt(d);
      const across = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(side);
      return p.add(across).setY(DECK + 0.2);
    });
    return {
      geometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 2, 0.08, 4),
      color: "#8a8f98",
    };
  });
  return mergeColoredParts(parts);
};

/** Low and mid-rise blocks merged into one mesh, scattered in `area` at least `clear` metres from the line. */
export const createBuildings = (
  path: Path,
  area: readonly [number, number, number, number],
  count: number,
  clear = 30,
) => {
  const random = seededRandom(7);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const palette = ["#e8e2d6", "#d9d4cc", "#c9ccd2", "#e6d5c3", "#bfc6cf", "#efe9df"];
  const parts: ColoredPart[] = [];
  const samples = path.every(20).map((d) => path.pointAt(d));
  let tries = 0;
  while (parts.length < count && tries++ < count * 20) {
    const x = area[0] + random() * (area[2] - area[0]);
    const z = area[1] + random() * (area[3] - area[1]);
    if (samples.some((p) => Math.hypot(p.x - x, p.z - z) < clear)) continue;
    const w = 12 + random() * 18;
    const d = 12 + random() * 18;
    const h = 8 + random() ** 2 * 50;
    parts.push({
      geometry: box,
      color: palette[Math.floor(random() * palette.length)],
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * 0.3),
        new THREE.Vector3(w, h, d),
      ),
    });
  }
  return mergeColoredParts(parts);
};
