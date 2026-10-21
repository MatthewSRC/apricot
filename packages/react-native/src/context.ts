import type { ApricotScene } from "@apricotjs/core";
import { createContext, useContext } from "react";

export const SceneContext = createContext<ApricotScene | null>(null);

/** The ApricotScene of the closest <Scene>. */
export const useScene = (): ApricotScene => {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error("useScene() must be used inside <Scene>");
  return scene;
};
