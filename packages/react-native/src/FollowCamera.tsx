import { type FollowOptions, FollowRig } from "@apricotjs/core";
import { type RefObject, useState } from "react";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import type { SceneObject } from "./parent";

export interface FollowCameraProps extends FollowOptions {
  /** The object to chase, such as a <Vehicle ref>. */
  target: RefObject<SceneObject | null>;
}

/**
 * Moves the scene camera behind and above `target`, easing after it and
 * looking a little ahead. Place it after the target in the tree, so it runs
 * after the target has moved each frame. Options are read once, at mount.
 */
export function FollowCamera({ target, ...options }: FollowCameraProps) {
  const scene = useScene();
  const [rig] = useState(() => new FollowRig(options));
  useFrame(({ delta }) => {
    if (!target.current) return false;
    return rig.update(scene.camera, target.current, delta);
  });
  return null;
}
