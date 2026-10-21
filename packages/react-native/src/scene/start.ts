import { ApricotScene, gpuSupport, NO_GPU_MESSAGE, type SceneOptions, sceneRegistry } from "@apricotjs/core";
import { type RefObject, useEffect } from "react";
import { PixelRatio, Platform } from "react-native";
import type { CanvasRef } from "react-native-webgpu";

/** A view size in points. */
export interface ViewSize {
  width: number;
  height: number;
}

// getContext() returns null, or a canvas of size 0, until the view is laid out.
const waitForContext = async (ref: RefObject<CanvasRef | null>, isCancelled: () => boolean) => {
  for (let i = 0; i < 120 && !isCancelled(); i++) {
    const context = ref.current?.getContext("webgpu");
    const canvas = context?.canvas as HTMLCanvasElement | undefined;
    if (context && canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) return { context, canvas };
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
};

// On the web the canvas is a <canvas> element with this id (react-native-webgpu's contextIdToId).
const webCanvas = (ref: RefObject<CanvasRef | null>) => {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const id = (ref.current as { getContextId?: () => number } | null)?.getContextId?.();
  const element = id === undefined ? null : document.getElementById(`rnwgpu-canvas-${id}`);
  return element instanceof HTMLCanvasElement ? element : null;
};

// A browser without a WebGPU adapter draws with WebGL 2. A canvas has one kind of context for good, so
// this runs before the WebGPU context is requested.
const waitForWebGL = async (element: HTMLCanvasElement, isCancelled: () => boolean) => {
  for (let i = 0; i < 120 && !isCancelled(); i++) {
    if (element.clientWidth > 0 && element.clientHeight > 0) {
      const context = element.getContext("webgl2", {
        antialias: true,
        alpha: true,
        depth: true,
        stencil: false,
      });
      if (!context) throw new Error(`${NO_GPU_MESSAGE}, and neither is WebGL 2`);
      return { context, canvas: element };
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
};

export interface SceneStart {
  canvas: RefObject<CanvasRef | null>;
  /** Options for the new scene. Read once, at mount. */
  options: RefObject<SceneOptions>;
  /** Whether the scene should start paused. */
  paused: RefObject<boolean>;
  /** The view's latest layout, if it has been laid out. */
  layout: RefObject<ViewSize | null>;
  /** Called with the scene once it is attached to the canvas. */
  onStart: (scene: ApricotScene) => void;
  /** Called on unmount. */
  onStop: () => void;
  /** Called if the scene fails to start. */
  onError: (error: Error) => void;
}

/**
 * Creates an ApricotScene on mount, attaches it to the canvas once the canvas
 * has a size, and releases it on unmount.
 */
export function useStartScene({ canvas, options, paused, layout, onStart, onStop, onError }: SceneStart) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, at mount; the callbacks must not depend on render state
  useEffect(() => {
    let cancelled = false;
    // Acquired and released in the same effect, so a StrictMode remount gets a fresh scene.
    const { id, scene: created } = sceneRegistry.acquire(undefined, () => new ApricotScene(options.current));
    void (async () => {
      try {
        const element = webCanvas(canvas);
        const webgl = element !== null && (await gpuSupport()) !== "webgpu";
        if (cancelled) return;
        const isCancelled = () => cancelled;
        const found =
          element && webgl
            ? await waitForWebGL(element, isCancelled)
            : await waitForContext(canvas, isCancelled);
        if (cancelled) return;
        if (!found) throw new Error("WebGPU canvas context not available");
        // A scene paused from the start still compiles its shaders, and draws once unpaused.
        if (paused.current) created.pause();
        await created.attach(found.context, {
          width: found.canvas.clientWidth,
          height: found.canvas.clientHeight,
          devicePixelRatio: PixelRatio.get(),
        });
        if (cancelled) {
          created.detach();
          return;
        }
        // The view may have been resized while the renderer was starting.
        if (layout.current) created.resize({ ...layout.current, devicePixelRatio: PixelRatio.get() });
        onStart(created);
      } catch (e) {
        if (cancelled) return;
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      cancelled = true;
      onStop();
      sceneRegistry.release(id);
    };
  }, []);
}
