import * as THREE from "three/webgpu";

// Scratch objects. Both functions return them, so a result is valid until the next call.
const part = new THREE.Box3();
const corner = new THREE.Vector3();
const rect = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

/** The world-space box of `mesh` alone, without its children, covering all its instances. */
export const worldBox = (mesh: THREE.Mesh) => {
  const instanced = mesh as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    if (!instanced.boundingBox) instanced.computeBoundingBox();
    part.copy(instanced.boundingBox as THREE.Box3);
  } else {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    part.copy(mesh.geometry.boundingBox as THREE.Box3);
  }
  return part.applyMatrix4(mesh.matrixWorld);
};

/** The extent of box `b` in a light's view space (`toLight`). */
export const lightRect = (b: THREE.Box3, toLight: THREE.Matrix4) => {
  rect.minX = rect.minY = rect.minZ = Number.POSITIVE_INFINITY;
  rect.maxX = rect.maxY = rect.maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
    corner.applyMatrix4(toLight);
    rect.minX = Math.min(rect.minX, corner.x);
    rect.maxX = Math.max(rect.maxX, corner.x);
    rect.minY = Math.min(rect.minY, corner.y);
    rect.maxY = Math.max(rect.maxY, corner.y);
    rect.minZ = Math.min(rect.minZ, corner.z);
    rect.maxZ = Math.max(rect.maxZ, corner.z);
  }
  return rect;
};
