import { compileWhileHidden, leaveOutOfFootprint } from "@apricotjs/core";
import { type ReactNode, type Ref, useImperativeHandle, useLayoutEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { ParentContext, type SceneObject, useAttach } from "./parent";
import { type TransformProps, useTransform } from "./transform";

export interface GroupProps extends TransformProps {
  name?: string;
  /** The underlying three.js group, for example as a <FollowCamera> target. */
  ref?: Ref<SceneObject>;
  /**
   * Whether the group and its children are shown (default true). A hidden
   * group is still warmed up with the scene, so showing it later is immediate,
   * with no frame spent compiling shaders. For example, keep a shop's items
   * ready and show one at a time.
   */
  visible?: boolean;
  /**
   * Set to false so that its children take up no floor space in a
   * <Placeable> and its <Placement>, such as a palm's fronds reaching over
   * the sand or a lamp's glow. They still show, and other things can stand
   * under them. Default true.
   */
  footprint?: boolean;
  children?: ReactNode;
}

/** An empty node that transforms its children together. */
export function Group({ name, ref, visible = true, footprint = true, children, ...transform }: GroupProps) {
  const scene = useScene();
  const [group] = useState(() => {
    const made = new THREE.Group();
    compileWhileHidden(made);
    return made;
  });
  group.name = name ?? "";
  useImperativeHandle(ref, () => group, [group]);
  useAttach(group);
  useTransform(group, transform);
  useLayoutEffect(() => {
    if (footprint) return;
    leaveOutOfFootprint(group);
    return () => leaveOutOfFootprint(group, false);
  }, [group, footprint]);
  useLayoutEffect(() => {
    if (group.visible === visible) return;
    group.visible = visible;
    scene.invalidate();
  }, [group, visible, scene]);
  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}

export interface PrimitiveProps extends TransformProps {
  /** Any three.js object, added to the scene as is. */
  object: THREE.Object3D;
  ref?: Ref<SceneObject>;
  children?: ReactNode;
}

/** Adds an existing three.js object to the scene. Its children nest under it. */
export function Primitive({ object, ref, children, ...transform }: PrimitiveProps) {
  useImperativeHandle(ref, () => object, [object]);
  useAttach(object);
  useTransform(object, transform);
  return <ParentContext.Provider value={object}>{children}</ParentContext.Provider>;
}
