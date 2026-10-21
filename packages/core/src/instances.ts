import * as THREE from "three/webgpu";
import type { PressHit } from "./press";
import type { Vec3 } from "./spin";

/** The transform and colour of one instance. */
export interface InstanceItem {
  position?: Vec3;
  /** Euler angles in radians (x, y, z). */
  rotation?: Vec3;
  /** A uniform scale, or [x, y, z] (default 1). */
  scale?: number | Vec3;
  /** Tint multiplied with the material's colour. */
  color?: THREE.ColorRepresentation;
  /** Set to false to hide this instance (default true). */
  visible?: boolean;
}

/** One mesh of the shape being instanced, with its transform relative to the shape's origin. */
export interface InstancePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** The part's transform within the shape (identity for a single geometry). */
  offset: THREE.Matrix4;
}

/**
 * The meshes under `object`, such as a loaded model, with their transforms
 * relative to `object`, for instancing them together. Skinned and instanced
 * meshes are skipped.
 */
export const instanceParts = (object: THREE.Object3D): InstancePart[] => {
  object.updateWorldMatrix(true, true);
  const root = object.matrixWorld.clone().invert();
  const parts: InstancePart[] = [];
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (
      !mesh.isMesh ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      (mesh as THREE.InstancedMesh).isInstancedMesh
    )
      return;
    parts.push({
      geometry: mesh.geometry,
      material: mesh.material,
      offset: root.clone().multiply(mesh.matrixWorld),
    });
  });
  return parts;
};

const matrix = new THREE.Matrix4();
const placed = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const color = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Many instances of one shape, drawn with one draw call per part however
 * many there are. Each instance has its own position, rotation, scale and
 * colour. The geometry and materials belong to the caller and are not
 * disposed here.
 */
export class InstanceSet {
  /** The group holding the instanced meshes. Add it to the scene. */
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private capacity: number;
  private count = 0;
  private colored = false;

  constructor(
    private readonly parts: readonly InstancePart[],
    capacity = 16,
  ) {
    this.capacity = Math.max(1, capacity);
    this.build();
  }

  /** The instanced meshes, one per part. */
  get instancedMeshes(): readonly THREE.InstancedMesh[] {
    return this.meshes;
  }

  /** The number of instances. */
  get size() {
    return this.count;
  }

  /** Replaces all instances, growing capacity as needed. */
  setItems(items: readonly InstanceItem[]) {
    if (items.length > this.capacity) this.grow(items.length);
    this.count = items.length;
    for (let i = 0; i < items.length; i++) this.write(i, items[i]);
    this.changed();
  }

  /** Updates one instance, for example from a frame callback. */
  set(index: number, item: InstanceItem) {
    if (index < 0 || index >= this.count) throw new RangeError(`No copy ${index} (there are ${this.count})`);
    this.write(index, item);
    this.changed();
  }

  /** The index of the instance a press hit, or null if it hit something else. */
  indexOf(hit: Pick<PressHit, "mesh" | "instanceId">) {
    if (hit.instanceId === undefined || !this.meshes.includes(hit.mesh as THREE.InstancedMesh)) return null;
    return hit.instanceId < this.count ? hit.instanceId : null;
  }

  /**
   * Frees the instance buffers on the GPU, but not the shared geometry and
   * materials. The meshes are kept, so a set that is shown again, as with a
   * React StrictMode remount, uploads its buffers again.
   */
  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
  }

  private build() {
    const previous = this.meshes;
    this.meshes = this.parts.map((part, i) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.capacity);
      mesh.count = this.count;
      const old = previous[i];
      if (old) {
        mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, mesh.instanceMatrix.array.length));
        if (old.instanceColor) {
          this.ensureColor(mesh);
          (mesh.instanceColor as THREE.InstancedBufferAttribute).array.set(old.instanceColor.array);
        }
        old.dispose();
      }
      return mesh;
    });
    this.group.clear();
    if (this.meshes.length) this.group.add(...this.meshes);
  }

  private grow(needed: number) {
    while (this.capacity < needed) this.capacity *= 2;
    this.build();
  }

  // Adds an instance colour buffer, white for every instance so the material's colour shows.
  private ensureColor(mesh: THREE.InstancedMesh) {
    if (mesh.instanceColor) return;
    const colors = new Float32Array(this.capacity * 3).fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  }

  private write(i: number, item: InstanceItem) {
    if (item.visible === false) {
      matrix.copy(HIDDEN);
    } else {
      const [x = 0, y = 0, z = 0] = item.position ?? [];
      const [rx = 0, ry = 0, rz = 0] = item.rotation ?? [];
      const s = item.scale ?? 1;
      position.set(x, y, z);
      quaternion.setFromEuler(rotation.set(rx, ry, rz));
      if (typeof s === "number") scale.setScalar(s);
      else scale.set(s[0], s[1], s[2]);
      matrix.compose(position, quaternion, scale);
    }
    if (item.color !== undefined && !this.colored) {
      this.colored = true;
      for (const mesh of this.meshes) this.ensureColor(mesh);
    }
    if (this.colored) color.set(item.color ?? 0xffffff);
    this.meshes.forEach((mesh, p) => {
      mesh.setMatrixAt(i, placed.multiplyMatrices(matrix, this.parts[p].offset));
      if (this.colored) mesh.setColorAt(i, color);
    });
  }

  private changed() {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.visible = this.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Clear the cached bounds, which culling and raycasting use, so they are recomputed.
      mesh.boundingSphere = null;
      mesh.boundingBox = null;
    }
  }
}
