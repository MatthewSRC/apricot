import type * as THREE from "three/webgpu";
import { skipBundles, skipsBundles } from "../bundle";
import type { SceneOcclusion } from "../occlusion";
import { compilesWhileHidden } from "./objects";
import type { SceneRenderer } from "./types";

/**
 * Makes everything under `roots` visible to three's compileAsync, which
 * skips objects the camera cannot see, hidden objects, and the contents of
 * bundles. Turns off frustum culling, shows objects marked with
 * compileWhileHidden, and has `camera` see bundle contents as plain groups.
 * Returns the number of meshes found and a function that undoes the changes.
 */
export const exposeForCompile = (roots: readonly THREE.Object3D[], camera: THREE.Camera) => {
  let meshes = 0;
  const culled: THREE.Object3D[] = [];
  const hidden: THREE.Object3D[] = [];
  for (const root of roots)
    root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes++;
      if (object.frustumCulled) {
        object.frustumCulled = false;
        culled.push(object);
      }
      if (!object.visible && compilesWhileHidden(object)) {
        object.visible = true;
        hidden.push(object);
      }
    });
  const skipped = skipsBundles(camera);
  skipBundles(camera);
  const restore = () => {
    for (const object of culled) object.frustumCulled = true;
    for (const object of hidden) object.visible = false;
    skipBundles(camera, skipped);
  };
  return { meshes, restore };
};

/**
 * Compiles the shaders of `roots`. A root other than `scene` is compiled
 * with the scene's lights. With occlusion, the scene draws into the
 * occlusion's targets with its outputs, so it compiles for those instead.
 */
export const compileRoots = (
  renderer: SceneRenderer,
  occlusion: SceneOcclusion | null,
  roots: readonly THREE.Object3D[],
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<void> =>
  occlusion
    ? occlusion.compileAsync(roots)
    : Promise.all(
        roots.map(
          (root) =>
            (root === scene
              ? renderer.compileAsync?.(scene, camera)
              : renderer.compileAsync?.(root, camera, scene)) ?? Promise.resolve(),
        ),
      ).then(() => {});
