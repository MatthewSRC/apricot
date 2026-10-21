import type { Vec3 } from "@apricotjs/core";
import { useEffect, useLayoutEffect } from "react";
import type * as THREE from "three/webgpu";
import { type Animatable, isShared, useAnimatable } from "./animatable";
import { useScene } from "./context";

export interface TransformProps {
  /** Position in the parent's space, in metres. */
  position?: Animatable<Vec3>;
  /** Euler angles in radians (XYZ order). */
  rotation?: Animatable<Vec3>;
  /** Uniform scale or per-axis scale. */
  scale?: Animatable<number | Vec3>;
}

export interface TransformValues {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
}

/** Writes the given transform values to `object`; unset values are left alone. */
export const applyTransform = (object: THREE.Object3D, { position, rotation, scale }: TransformValues) => {
  if (position) object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (typeof scale === "number") object.scale.setScalar(scale);
  else if (scale) object.scale.set(scale[0], scale[1], scale[2]);
};

/** Keeps `object`'s transform in sync with props (plain or shared values). */
export const useTransform = (object: THREE.Object3D, props: TransformProps) => {
  const scene = useScene();
  const live = isShared(props.position) || isShared(props.rotation) || isShared(props.scale);
  const position = useAnimatable(props.position);
  const rotation = useAnimatable(props.rotation);
  const scale = useAnimatable(props.scale);
  // Plain values are written only when they change, so still shapes cost nothing per frame.
  const plain = live ? null : JSON.stringify([props.position, props.rotation, props.scale]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `plain` stands for the plain values
  useLayoutEffect(() => {
    if (plain === null) return;
    applyTransform(object, { position: position(), rotation: rotation(), scale: scale() });
    scene.invalidate();
  }, [object, plain, scene]);
  // Shared values are read before every frame.
  useEffect(() => {
    if (!live) return;
    return scene.onFrame(() => {
      applyTransform(object, { position: position(), rotation: rotation(), scale: scale() });
    });
  }, [live, object, scene, position, rotation, scale]);
};
