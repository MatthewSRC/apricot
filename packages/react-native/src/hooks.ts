import type { FrameCallback } from "@apricotjs/core";
import { useEffect, useRef } from "react";
import { useScene } from "./context";

/**
 * Runs `callback` before every rendered frame. Return `true` while animating
 * to keep the scene rendering; otherwise the loop sleeps until something
 * changes (frameloop="demand").
 */
export const useFrame = (callback: FrameCallback) => {
  const scene = useScene();
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => scene.onFrame((state) => ref.current(state)), [scene]);
};
