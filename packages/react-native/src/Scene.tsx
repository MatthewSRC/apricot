import type { ApricotScene, CameraOptions, FrameLoopMode, Look, SceneOptions } from "@apricotjs/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppState, PixelRatio, Platform, StyleSheet, View, type ViewProps } from "react-native";
import { type AndroidCanvasProps, Canvas, type CanvasRef } from "react-native-webgpu";
import { Color, type ColorRepresentation } from "three/webgpu";
import { SceneContext } from "./context";
import { DebugHud } from "./DebugHud";
import { ParentContext } from "./parent";
import { useSceneGestures } from "./scene/gestures";
import { useContentIn } from "./scene/loadingOrder";
import { useStartScene, type ViewSize } from "./scene/start";
import { type SceneTouches, TouchContext } from "./touches";

export interface SceneProps extends ViewProps {
  /** "demand" (default) renders only when something changes; "always" renders every frame. */
  frameloop?: FrameLoopMode;
  /**
   * Stops drawing while true; the last frame stays on screen. Use it for a
   * scene that is mounted but not visible, such as one preloaded, under
   * another screen or on another carousel page. A paused scene costs nothing
   * per frame, but still compiles its shaders once visible scenes have drawn,
   * so it shows immediately when unpaused. Scenes also pause while the app is
   * in the background.
   *
   * Prefer this to fading the view to opacity 0, which keeps drawing and may
   * stall the app on iOS. To fade a scene in, start from an opacity of 0.02.
   */
  paused?: boolean;
  /** Lighting preset: "soft" (default), "studio", "flat", or "none" to add your own lights. */
  look?: Look | "none";
  /** Camera position, target and field of view. */
  camera?: CameraOptions;
  /** Fades distant objects into the background: `true`, or `{ near, far, color }`. */
  fog?: SceneOptions["fog"];
  /**
   * What metals and glossy materials reflect: "studio", "soft", "sunset",
   * "night", a name registered with defineEnvironment, your own setup, or
   * "none" (default). Environments are procedural, so there is no map to
   * generate. To change it later, use <Environment>.
   */
  environment?: SceneOptions["environment"];
  /**
   * Makes the canvas transparent so the views behind it show through. Combine
   * with `pointerEvents="none"` to let touches through as well.
   */
  transparent?: boolean;
  /** Background colour, overriding the look's. Changes are applied. */
  background?: ColorRepresentation;
  /**
   * How light is mapped to screen colours, overriding the look's: "agx"
   * (default), "neutral" (closer to the colours as written), "filmic" or "none".
   */
  toneMapping?: SceneOptions["toneMapping"];
  /** Brightens (above 1) or darkens (below 1) the whole picture (default 1). */
  exposure?: number;
  /**
   * Seconds to keep rendering after the last change in "demand" mode (default
   * 0.25), so that drags and sensor input animate smoothly.
   */
  linger?: number;
  /**
   * Shadows from the main directional light: `true`, or `{ size, softness,
   * darkness, radius }`. Everything casts and receives shadows except floors,
   * which only receive, and transparent objects. `castShadow` and
   * `receiveShadow` on an object override this. Shadows are redrawn only when
   * a caster moves.
   */
  shadows?: SceneOptions["shadows"];
  /**
   * Ambient occlusion: soft darkening where surfaces meet or come close, such
   * as the corners of a room or the floor under a sofa. `true`, or
   * `{ radius, strength, resolution }`.
   */
  occlusion?: SceneOptions["occlusion"];
  /**
   * How many <Lamp>s may light the scene at once (default 0: lamps only glow).
   * The slots are created up front, so lamps can come and go without
   * rebuilding shaders. When more lamps are on, the brightest win. Each slot
   * adds a small cost to every lit material.
   */
  lamps?: number;
  /**
   * "standard" (default) or "dynamic". With "dynamic", lights are passed to
   * shaders as arrays, so they can come and go without rebuilding shaders and
   * each one costs only while it is on. This allows a large `lamps` count.
   */
  lighting?: SceneOptions["lighting"];
  /** Caps the device pixel ratio (default 2). */
  maxPixelRatio?: number;
  /**
   * Shows fps, render and present time (and GPU time where the device reports
   * it), and a Share button for the performance report.
   */
  debug?: boolean;
  /** Android backing view (the react-native-webgpu `android` prop). */
  android?: AndroidCanvasProps;
  /** Called once the renderer is ready. */
  onCreated?: (scene: ApricotScene) => void;
  /**
   * Called once the scene first draws its content. Until then it shows only
   * its background while shaders compile, which takes about a second on a
   * phone. Use it to hide your own loading state.
   */
  onReady?: (scene: ApricotScene) => void;
  /**
   * Shown over the scene until it first draws its content, covering both GPU
   * start-up (blank canvas) and shader compilation (background only). For
   * example a spinner, a splash or a placeholder image.
   *
   *   <Scene loading={<ActivityIndicator />}>…</Scene>
   */
  loading?: ReactNode;
  /** Called if the renderer fails to start. */
  onError?: (error: Error) => void;
  children?: ReactNode;
}

const OVERLAY = [StyleSheet.absoluteFill, { pointerEvents: "none" as const }];

/**
 * A 3D scene. Children render once the GPU is ready and can use useScene()
 * and useFrame().
 */
export function Scene({
  frameloop = "demand",
  paused = false,
  look,
  camera,
  fog,
  environment,
  transparent = false,
  background,
  toneMapping,
  exposure,
  maxPixelRatio,
  linger,
  shadows,
  occlusion,
  lamps,
  lighting,
  debug = false,
  android,
  onCreated,
  onReady,
  loading,
  onError,
  children,
  style,
  pointerEvents,
  onLayout,
  ...viewProps
}: SceneProps) {
  const canvasRef = useRef<CanvasRef>(null);
  const outer = useRef<View>(null);
  const [scene, setScene] = useState<ApricotScene | null>(null);
  // Touch listeners such as <CameraRig orbit>.
  const [touches] = useState<SceneTouches>(() => new Set());
  // While something listens, browsers must not scroll or zoom the page under a finger.
  const [claiming, setClaiming] = useState(false);
  touches.changed = () => setClaiming(touches.size > 0);
  const ready = useRef<ApricotScene | null>(null);
  ready.current = scene;
  const layout = useRef<ViewSize | null>(null);
  // Read once at mount. Later changes to these props do not rebuild the scene.
  const initial = useRef<SceneOptions>({
    frameloop,
    look,
    camera,
    fog,
    environment,
    transparent,
    background,
    toneMapping,
    exposure,
    maxPixelRatio,
    linger,
    shadows,
    occlusion,
    lamps,
    lighting,
    gpuTiming: debug,
  });
  const callbacks = useRef({ onCreated, onReady, onError });
  callbacks.current = { onCreated, onReady, onError };

  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!scene) return;
    return scene.onReady(() => {
      setDrawn(true);
      callbacks.current.onReady?.(scene);
    });
  }, [scene]);

  useEffect(() => {
    scene?.loop.setMode(frameloop);
  }, [scene, frameloop]);

  const [appActive, setAppActive] = useState(() => AppState.currentState !== "background");
  const stopped = useRef(paused || !appActive);
  stopped.current = paused || !appActive;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => setAppActive(state !== "background"));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    scene?.pause(paused || !appActive);
  }, [scene, paused, appActive]);

  const [failed, setFailed] = useState(false);
  const contentIn = useContentIn(paused, !paused && appActive && !drawn && !failed);

  useBackground(scene, initial.current.transparent ? undefined : background);

  useStartScene({
    canvas: canvasRef,
    options: initial,
    paused: stopped,
    layout,
    onStart: (created) => {
      setScene(created);
      callbacks.current.onCreated?.(created);
    },
    onStop: () => setScene(null),
    onError: (error) => {
      setFailed(true);
      if (callbacks.current.onError) callbacks.current.onError(error);
      else console.error("[apricot] Scene failed to start:", error);
    },
  });

  // The first size comes from the canvas when the scene attaches. Later layouts (rotation, split
  // screen) resize it, and the latest is kept for a resize while the renderer is still starting.
  const handleLayout: ViewProps["onLayout"] = (event) => {
    const { width, height } = event.nativeEvent.layout;
    layout.current = { width, height };
    ready.current?.resize({ width, height, devicePixelRatio: PixelRatio.get() });
    onLayout?.(event);
  };

  const { dragProps, tapProps } = useSceneGestures(outer, touches, ready, viewProps);

  return (
    <View
      ref={outer}
      style={[
        style,
        pointerEvents ? { pointerEvents } : null,
        claiming && Platform.OS === "web" ? ({ touchAction: "none" } as object) : null,
      ]}
      onLayout={handleLayout}
      {...dragProps}
      {...viewProps}
      {...tapProps}
    >
      <Canvas
        ref={canvasRef}
        // The surrounding view handles all touches. On iOS a native view that handles touches
        // itself receives only the first finger, so pinches would never reach the scene.
        style={OVERLAY}
        opaque={!transparent}
        android={android}
      />
      {scene && contentIn ? (
        <SceneContext.Provider value={scene}>
          <TouchContext.Provider value={touches}>
            <ParentContext.Provider value={scene.scene}>{children}</ParentContext.Provider>
          </TouchContext.Provider>
        </SceneContext.Provider>
      ) : null}
      {loading !== undefined && !drawn ? <View style={OVERLAY}>{loading}</View> : null}
      {debug && scene ? <DebugHud stats={scene.stats} scene={scene} /> : null}
    </View>
  );
}

/** Applies changes to the `background` prop. The scene was created with the first value. */
const useBackground = (scene: ApricotScene | null, background: ColorRepresentation | undefined) => {
  const first = useRef(background);
  useEffect(() => {
    if (!scene || background === undefined) return;
    if (background === first.current) return;
    first.current = undefined;
    const current = scene.scene.background;
    if (current instanceof Color) current.set(background);
    else scene.scene.background = new Color(background);
    scene.invalidate();
  }, [scene, background]);
};
