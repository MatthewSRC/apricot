import * as THREE from "three/webgpu";
import type { SceneOptions, SceneRenderer } from "./types";

// Where a renderer draws: a render target (null for the screen) and a canvas target.
type Aimable = {
  getRenderTarget: () => unknown;
  setRenderTarget: (target: unknown) => void;
  getCanvasTarget?: () => unknown;
  setCanvasTarget?: (target: unknown) => void;
};

/**
 * One scene's settings on a renderer shared with other scenes: its canvas
 * target, tone mapping, exposure and clear colour. They are applied before
 * the scene draws or compiles with the renderer.
 */
export class SharedRendererAim {
  /** The scene's canvas on the shared renderer, or null when the scene has no shared renderer. */
  target: THREE.CanvasTarget | null = null;
  toneMapping: THREE.ToneMapping = THREE.NoToneMapping;
  // Where the renderer pointed before the current frame.
  private saved: { target: unknown; canvas: unknown } | null = null;

  constructor(private readonly options: Pick<SceneOptions, "exposure" | "transparent">) {}

  /** Sets up `renderer` to draw this scene. */
  apply(renderer: SceneRenderer | null) {
    const shared = renderer as (SceneRenderer & { setCanvasTarget?: (t: THREE.CanvasTarget) => void }) | null;
    if (!shared || !this.target) return;
    shared.setCanvasTarget?.(this.target);
    shared.toneMapping = this.toneMapping;
    shared.toneMappingExposure = this.options.exposure ?? 1;
    shared.setClearColor(0x000000, this.options.transparent ? 0 : 1);
  }

  /**
   * Points `renderer` at this scene's screen before a frame. Another
   * scene's warm-up may have left it on a different target between its
   * steps (an occlusion pass), so that target is saved and restored by end().
   */
  begin(renderer: SceneRenderer | null) {
    const aimable = renderer as unknown as Aimable | null;
    if (!aimable || !this.target) return;
    // Already saved when the previous frame threw before end() ran.
    this.saved ??= { target: aimable.getRenderTarget(), canvas: aimable.getCanvasTarget?.() ?? null };
    aimable.setRenderTarget(null);
    this.apply(renderer);
  }

  /** Points `renderer` back where begin() found it, after a frame. */
  end(renderer: SceneRenderer | null) {
    const aimable = renderer as unknown as Aimable | null;
    const saved = this.saved;
    this.saved = null;
    if (!aimable || !saved) return;
    aimable.setRenderTarget(saved.target);
    if (saved.canvas) aimable.setCanvasTarget?.(saved.canvas);
  }
}
