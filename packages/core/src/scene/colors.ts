import * as THREE from "three/webgpu";
import { untoneMapped } from "../tonemap";
import type { SceneRenderer } from "./types";

/**
 * Swaps a scene's background and fog colours for the values that show as
 * written after tone mapping, so `background="#ffffff"` shows white rather
 * than light grey (see untoneMapped).
 */
export class ScreenColors {
  private readonly cache = new Map<string, THREE.Color>();

  private drawn(color: THREE.Color, renderer: SceneRenderer) {
    const exposure = renderer.toneMappingExposure ?? 1;
    const key = `${color.r},${color.g},${color.b},${renderer.toneMapping},${exposure}`;
    let drawn = this.cache.get(key);
    if (!drawn) {
      // A scene uses a few colours; the cache is cleared if something animates them.
      if (this.cache.size > 64) this.cache.clear();
      drawn = untoneMapped(color, renderer.toneMapping, exposure);
      this.cache.set(key, drawn);
    }
    return drawn;
  }

  /** Swaps the colours of `scene` for drawing with `renderer`. Returns a function that restores them. */
  swap(scene: THREE.Scene, renderer: SceneRenderer) {
    const background = scene.background;
    const fog = scene.fog;
    const fogColor = fog ? fog.color.clone() : null;
    if (background instanceof THREE.Color) scene.background = this.drawn(background, renderer);
    if (fog) fog.color.copy(this.drawn(fog.color, renderer));
    return () => {
      scene.background = background;
      if (fog && fogColor) fog.color.copy(fogColor);
    };
  }
}
