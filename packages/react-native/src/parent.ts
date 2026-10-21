import { createContext, useContext, useEffect, useRef } from "react";
import type * as THREE from "three/webgpu";
import { useScene } from "./context";

/**
 * An object in a scene, as held by a ref on <Box>, <Group>, <Model>,
 * <Vehicle> or a light. Change its `position`, `rotation`, `scale` or
 * `visible`, or pass it to <FollowCamera target>, <Label attach> or
 * <CameraRig follow>.
 *
 *   const car = useRef<SceneObject>(null);
 *   <Vehicle ref={car} … />
 *   <FollowCamera target={car} />
 */
export type SceneObject = THREE.Object3D;

/**
 * Shapes that a <Merged> draws as part of its merged mesh, mapped to the
 * visibility they would otherwise have. The shapes themselves are hidden.
 * While baked in, a shape writes its `visible` prop here instead of to the
 * object, which would show it separately for a frame.
 */
export const bakedIn = new WeakMap<THREE.Object3D, boolean>();

/** The object new children attach to: the scene root, or the closest <Group>. */
export const ParentContext = createContext<THREE.Object3D | null>(null);

/** The object that new children attach to. Throws outside <Scene>. */
export const useParent = (): THREE.Object3D => {
  const parent = useContext(ParentContext);
  if (!parent) throw new Error("Apricot components must be used inside <Scene>");
  return parent;
};

/** Adds `object` to the current parent while mounted. */
export const useAttach = (object: THREE.Object3D) => {
  const parent = useParent();
  const scene = useScene();
  // The same object moving to a new parent (as when a <Model>'s src changes) needs no warm-up.
  const attached = useRef<THREE.Object3D | null>(null);
  useEffect(() => {
    parent.add(object);
    scene.invalidate();
    // Compile its shaders before it is first drawn. It is left out of frames until then.
    if (attached.current !== object) scene.requestWarmUp(object, { added: true });
    attached.current = object;
    return () => {
      parent.remove(object);
      scene.invalidate();
    };
  }, [parent, object, scene]);
};
