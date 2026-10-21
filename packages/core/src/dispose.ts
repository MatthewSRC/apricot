import type * as THREE from "three/webgpu";

/** Disposes the geometries, materials and textures of `root` and everything under it. */
export const disposeObject = (root: THREE.Object3D) => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      // Textures are material properties (map, normalMap, …).
      for (const value of Object.values(material)) {
        if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      }
      material.dispose();
    }
    (mesh as unknown as THREE.InstancedMesh).dispose?.();
  });
};
