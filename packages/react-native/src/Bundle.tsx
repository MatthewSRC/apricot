import { StillGroup } from "@apricotjs/core";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useState } from "react";
import { useScene } from "./context";
import { ParentContext, type SceneObject, useAttach } from "./parent";
import { type TransformProps, useTransform } from "./transform";

export interface BundleProps extends TransformProps {
  ref?: Ref<SceneObject>;
  children?: ReactNode;
}

/**
 * Draws its children as one recorded WebGPU render bundle that is replayed
 * every frame. A room of thirty pieces then costs the CPU a fraction of
 * drawing them one by one, which matters most on Android. Children may still
 * move and turn. Adding, removing or hiding a child, or changing its material,
 * records the bundle again once. Nothing inside is culled, so keep a bundle
 * to one area rather than a whole city. Bundles are drawn after everything
 * else, so put transparent objects such as glass or a <LightBeam> inside one
 * too, or they are drawn over.
 *
 *   <Bundle>
 *     <Room />
 *     <Placement>…</Placement>
 *   </Bundle>
 */
export function Bundle({ ref, children, ...transform }: BundleProps) {
  const scene = useScene();
  const [group] = useState(() => new StillGroup());
  useImperativeHandle(ref, () => group, [group]);
  useAttach(group);
  useTransform(group, transform);
  useEffect(() => {
    scene.bundles.add(group);
    scene.invalidate();
    return () => {
      scene.bundles.delete(group);
    };
  }, [scene, group]);
  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}
