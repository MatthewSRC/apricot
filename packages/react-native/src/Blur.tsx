import { BlurLayer, type BlurRenderer } from "@apricotjs/core";
import { type ReactNode, useEffect, useState } from "react";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { ParentContext } from "./parent";

export interface BlurProps {
  /** Blur radius in screen points (default 6). */
  radius?: number;
  children?: ReactNode;
}

/**
 * Draws its children blurred and behind everything else, as if out of focus,
 * such as falling fruit behind a sharp product. They are lit like the rest of
 * the scene. The blur is rendered at a fraction of the screen size, so it is
 * cheap.
 *
 *   <Blur radius={8}>
 *     <Instances object={peach} items={falling} />
 *   </Blur>
 *   <Model src={require("./peach.glb")} />
 */
export function Blur({ radius = 6, children }: BlurProps) {
  const scene = useScene();
  const [layer] = useState(() => new BlurLayer({ radius }));
  layer.setRadius(radius);

  useEffect(() => {
    const root = scene.scene;
    root.add(layer.group, layer.backdrop);
    scene.invalidate();
    return () => {
      root.remove(layer.group, layer.backdrop);
      layer.dispose();
      scene.invalidate();
    };
  }, [scene, layer]);

  useFrame(() => {
    const renderer = scene.threeRenderer;
    // Wait for the scene's first draw; the layer's warm-up comes after the scene's.
    if (!renderer || !scene.ready) return false;
    const drawn = layer.render(
      renderer as unknown as BlurRenderer,
      scene.scene,
      scene.camera,
      scene.size.width,
    );
    // Request frames until the blurred objects' shaders are ready.
    return !drawn && !layer.ready;
  });

  return <ParentContext.Provider value={layer.group}>{children}</ParentContext.Provider>;
}
