import { setShadow } from "@apricotjs/core";
import { useEffect } from "react";
import type * as THREE from "three/webgpu";
import { useScene } from "./context";

/** Shadow options for an object in a scene with `shadows`. Options left unset are chosen automatically. */
export interface ShadowProps {
  /** Whether it casts a shadow (default true, except for flat and transparent objects). */
  castShadow?: boolean;
  /** Whether shadows fall on it (default true, except for transparent objects). */
  receiveShadow?: boolean;
  /**
   * Hides the object but keeps its shadow. For example, a roof over a
   * cut-away room so that sunlight comes in only through the windows, or an
   * object off screen whose shadow falls into view.
   */
  shadowOnly?: boolean;
}

const shadowChoiceOf = ({ castShadow, receiveShadow, shadowOnly }: ShadowProps) => {
  if (shadowOnly) return { only: true };
  if (castShadow === undefined && receiveShadow === undefined) return undefined;
  return {
    ...(castShadow === undefined ? {} : { cast: castShadow }),
    ...(receiveShadow === undefined ? {} : { receive: receiveShadow }),
  };
};

/** Applies the shadow options that are set to each of `objects`. The rest stay automatic. */
export const useShadowChoice = (
  objects: readonly THREE.Object3D[],
  { castShadow, receiveShadow, shadowOnly }: ShadowProps,
) => {
  const scene = useScene();
  useEffect(() => {
    const choice = shadowChoiceOf({ castShadow, receiveShadow, shadowOnly });
    for (const object of objects) setShadow(object, choice);
    scene.invalidate();
  }, [objects, castShadow, receiveShadow, shadowOnly, scene]);
};
