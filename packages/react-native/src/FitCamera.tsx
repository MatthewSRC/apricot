import { fitCamera } from "@apricotjs/core";
import { useEffect } from "react";
import { useScene } from "./context";

export interface FitCameraProps {
  /** Width and height of the area to keep on screen, facing the camera. */
  size: readonly [number, number];
  /** Space to leave around it, as a fraction (default 0.1). */
  margin?: number;
  /** The point the camera looks at (default the origin). */
  target?: readonly [number, number, number];
}

/**
 * Keeps an area in view at any screen size by moving the camera along its
 * line of sight until `size` fits. It fits again after every resize. Useful
 * for product viewers, cards and single objects.
 */
export function FitCamera({ size, margin = 0.1, target = [0, 0, 0] }: FitCameraProps) {
  const scene = useScene();
  const [width, height] = size;
  const [x, y, z] = target;
  useEffect(() => {
    const refit = () => {
      fitCamera(scene.camera, width, height, { margin, target: [x, y, z] });
      scene.invalidate();
    };
    refit();
    return scene.onResize(refit);
  }, [scene, width, height, margin, x, y, z]);
  return null;
}
