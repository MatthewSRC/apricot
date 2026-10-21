import type * as THREE from "three/webgpu";

const COMPILE_HIDDEN = "apricot:compileHidden";

/**
 * Makes the scene's shader warm-up compile `object` even while it is
 * hidden. Use it for objects that show only now and then, such as particles
 * between bursts, so showing them does not stall a frame.
 */
export const compileWhileHidden = (object: THREE.Object3D) => {
  object.userData[COMPILE_HIDDEN] = true;
};

/** Whether compileWhileHidden was called on `object`. */
export const compilesWhileHidden = (object: THREE.Object3D) => Boolean(object.userData[COMPILE_HIDDEN]);

const contains = (root: THREE.Object3D, test: (object: THREE.Object3D) => boolean) => {
  let found = false;
  root.traverse((object) => {
    if (test(object)) found = true;
  });
  return found;
};

/** Whether `root` or anything under it is a light. */
export const hasLight = (root: THREE.Object3D) => contains(root, (o) => Boolean((o as THREE.Light).isLight));

/** Whether `root` or anything under it is a mesh. */
export const hasMesh = (root: THREE.Object3D) => contains(root, (o) => Boolean((o as THREE.Mesh).isMesh));

/** The objects in `scene` that are not inside another object of the list. */
export const outermost = (objects: THREE.Object3D[], scene: THREE.Object3D) => {
  const set = new Set(objects);
  return objects.filter((object) => {
    for (let o = object.parent; o; o = o.parent) {
      if (set.has(o)) return false;
      if (o === scene) return true;
    }
    return false;
  });
};

/** Whether `object` has `scene` among its ancestors. */
export const inScene = (object: THREE.Object3D, scene: THREE.Object3D) => {
  for (let o = object.parent; o; o = o.parent) if (o === scene) return true;
  return false;
};

/** Whether `object` is `root` or under it. */
export const within = (object: THREE.Object3D, root: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === root) return true;
  return false;
};

/** A name for diagnostics: the object's name, or its type. */
export const nameOf = (object: THREE.Object3D) => object.name || object.type;
