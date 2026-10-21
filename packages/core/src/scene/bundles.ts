import type * as THREE from "three/webgpu";
import type { StillGroup } from "../bundle";

/**
 * Records again the still groups whose contents changed. `lights` is a
 * scratch array, filled with the scene's lights outside bundles. Returns how
 * many groups will be recorded again.
 */
export const recheckBundles = (
  scene: THREE.Scene,
  bundles: ReadonlySet<StillGroup>,
  lights: THREE.Light[],
) => {
  if (bundles.size === 0) return 0;
  lights.length = 0;
  const visit = (object: THREE.Object3D) => {
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
    if ((object as THREE.BundleGroup).isBundleGroup) return;
    for (const child of object.children) visit(child);
  };
  visit(scene);
  let rerecorded = 0;
  for (const bundle of bundles) if (bundle.check(lights)) rerecorded++;
  return rerecorded;
};
