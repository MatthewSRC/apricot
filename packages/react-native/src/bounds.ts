import { type RefObject, useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import type { SceneObject } from "./parent";

/**
 * Set `userData[NO_BOUNDS]` on an object to leave it and its children out of
 * measured bounds, for example a shadow plane under a model.
 */
export const NO_BOUNDS = "apricotNoBounds";

// Subjects with at most this many meshes are measured from every vertex.
const EXACT_UP_TO = 50;

/**
 * The world-space box around the parts of `object` the camera sees. Hidden
 * objects, objects marked with NO_BOUNDS, and meshes on layers the camera
 * does not render, such as shadow-only meshes, are left out.
 */
export const seenBounds = (object: THREE.Object3D, camera: THREE.Camera) => {
  const seen: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || o.userData[NO_BOUNDS]) return;
    if ((o as THREE.Mesh).isMesh && o.layers.test(camera.layers)) seen.push(o as THREE.Mesh);
    for (const child of o.children) visit(child);
  };
  visit(object);
  // Large subjects use each geometry's bounding box, because measuring every vertex is slow.
  const exact = seen.length <= EXACT_UP_TO;
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const v = new THREE.Vector3();
  // Meshes are measured one by one, because three's expandByObject would measure nested shapes twice.
  for (const mesh of seen) {
    mesh.updateWorldMatrix(true, false);
    const own = mesh as THREE.Mesh & { boundingBox?: THREE.Box3 | null; computeBoundingBox?: () => void };
    const position = mesh.geometry?.getAttribute("position");
    if (own.boundingBox !== undefined) {
      // InstancedMesh and SkinnedMesh keep their own bounding box.
      own.computeBoundingBox?.();
      if (own.boundingBox) box.union(part.copy(own.boundingBox).applyMatrix4(mesh.matrixWorld));
    } else if (exact && position && position.count <= 5000) {
      for (let i = 0; i < position.count; i++)
        box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    } else if (position) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(part.copy(mesh.geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld));
    }
  }
  return box;
};

/**
 * Calls `changed` when an object is added or removed anywhere inside
 * `object`, for example when a nested model finishes loading. Returns a
 * function that stops watching.
 */
export const watchInside = (object: THREE.Object3D, changed: () => void) => {
  const watched = new Set<THREE.Object3D>();
  type Event = { child?: THREE.Object3D | null };
  const added = (event: Event) => {
    // Only the added subtree needs to be watched.
    if (event.child) event.child.traverse(watch);
    changed();
  };
  const removed = (event: Event) => {
    if (event.child) event.child.traverse(unwatch);
    changed();
  };
  const watch = (o: THREE.Object3D) => {
    if (watched.has(o)) return;
    watched.add(o);
    o.addEventListener("childadded", added);
    o.addEventListener("childremoved", removed);
  };
  const unwatch = (o: THREE.Object3D) => {
    if (!watched.delete(o)) return;
    o.removeEventListener("childadded", added);
    o.removeEventListener("childremoved", removed);
  };
  object.traverse(watch);
  return () => {
    for (const o of [...watched]) unwatch(o);
  };
};

/** A box in world space, in metres. */
export interface ObjectBounds {
  min: [number, number, number];
  max: [number, number, number];
  /** Width (x), height (y) and depth (z). */
  size: [number, number, number];
  center: [number, number, number];
}

const boundsOf = (box: THREE.Box3): ObjectBounds | null => {
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(), center: center.toArray() };
};

const sameBounds = (a: ObjectBounds | null, b: ObjectBounds | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.min.every((v, i) => Math.abs(v - b.min[i]) < 1e-6) &&
    a.max.every((v, i) => Math.abs(v - b.max[i]) < 1e-6));

/**
 * The box around `object` (a group, a model, or a ref to one) as the camera
 * sees it, for sizing or placing something by it, such as a shadow under an
 * object of any size or a label above it. Null until there is something to
 * measure. It is measured on the next frame, and again after something is
 * added inside the object or removed from it, after each render of the
 * component using it, and when `measure` changes.
 *
 *   const bounds = useBounds(piece);
 *   bounds && <Plane size={[bounds.size[0], bounds.size[2]]} position={[bounds.center[0], bounds.min[1], bounds.center[2]]} … />
 */
export function useBounds(
  object: SceneObject | RefObject<SceneObject | null> | null | undefined,
  { measure }: { measure?: unknown } = {},
): ObjectBounds | null {
  const scene = useScene();
  const [bounds, setBounds] = useState<ObjectBounds | null>(null);
  const target = object && "current" in object ? object.current : (object ?? null);
  const again = useRef<(() => void) | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `measure` asks for a new measurement
  useEffect(() => {
    if (!target) {
      setBounds(null);
      return;
    }
    // Measured in a frame callback, since shapes update their transforms in theirs.
    let pending = false;
    const remeasure = () => {
      if (pending) return;
      pending = true;
      scene.invalidate();
    };
    const stop = scene.onFrame(() => {
      if (!pending) return;
      pending = false;
      const next = boundsOf(seenBounds(target, scene.camera));
      setBounds((now) => (sameBounds(now, next) ? now : next));
    });
    remeasure();
    again.current = remeasure;
    const unwatch = watchInside(target, remeasure);
    return () => {
      again.current = null;
      stop();
      unwatch();
    };
  }, [scene, target, measure]);
  // A render may change the object's shape, so each one requests a new measurement.
  useEffect(() => {
    again.current?.();
  });
  return bounds;
}
