import { getEnvironment, type SoftBox, StudioEnvironmentNode, type StudioOptions } from "@apricotjs/core";
import { useEffect, useRef, useState } from "react";
import { type Animatable, useAnimatable } from "./animatable";
import { useScene } from "./context";
import { useFrame } from "./hooks";

export interface EnvironmentProps {
  /** A named environment: "studio", "soft", "sunset", "night", or one registered with defineEnvironment. */
  name?: string;
  /** Sky colours (ceiling, horizon, floor), used when `name` is not set. */
  sky?: StudioOptions["sky"];
  /** Soft boxes (direction, size, intensity, colour), used when `name` is not set. Moving them is cheap. */
  boxes?: readonly SoftBox[];
  /** Brightness multiplier (default 1). Accepts a shared value; changes are cheap. */
  intensity?: Animatable<number>;
  /** Rotation around the vertical axis, in radians (default 0). Accepts a shared value. */
  rotation?: Animatable<number>;
  /** Seconds over which a change of `name`, `sky` or `boxes` fades (default 0.6; 0 switches at once). */
  transition?: number;
}

// three.js types environmentNode narrowly; this code only stores and restores a node.
type WithEnvironment = { environmentNode: unknown };

const optionsOf = (
  name: string | undefined,
  sky: EnvironmentProps["sky"],
  boxes: EnvironmentProps["boxes"],
) => {
  if (name) return getEnvironment(name);
  const options: StudioOptions = {};
  if (sky) options.sky = sky;
  if (boxes) options.boxes = boxes;
  return options;
};

/**
 * Sets what metals and glossy materials reflect while mounted, either by name
 * or described with `sky` and `boxes`. Switching environments fades between
 * them, and `rotation`, `intensity` and the boxes' positions can change every
 * frame without rebuilding shaders.
 *
 *   <Environment name={night ? "night" : "studio"} rotation={swipeAngle} />
 */
export function Environment({
  name,
  sky,
  boxes,
  intensity = 1,
  rotation = 0,
  transition = 0.6,
}: EnvironmentProps) {
  const scene = useScene();
  const options = optionsOf(name, sky, boxes);
  const latest = useRef({ options, transition });
  latest.current = { options, transition };

  // One node for the component's lifetime, reusing the scene's if it has enough slots, so changes
  // fade instead of rebuilding shaders.
  const [node, setNode] = useState<StudioEnvironmentNode | null>(null);
  // Six slots hold every built-in environment; more boxes need a bigger node.
  const slots = Math.max(6, options.boxes?.length ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new node only when the slot count changes
  useEffect(() => {
    const root = scene.scene as unknown as WithEnvironment;
    const previous = root.environmentNode;
    const reuse = previous instanceof StudioEnvironmentNode && previous.light.fits(latest.current.options);
    const created = reuse ? previous : new StudioEnvironmentNode(latest.current.options);
    const before = reuse ? previous.options : null;
    if (reuse) created.light.set(latest.current.options, latest.current.transition);
    root.environmentNode = created;
    setNode(created);
    scene.invalidate();
    // A new node changes the shader of every lit material.
    if (!reuse) {
      scene.diagnostics.note("environment", { rebuilt: true });
      scene.requestWarmUp();
    }
    return () => {
      if (before) {
        created.light.set(before);
        created.light.rotation.value = 0;
        created.light.gain.value = 1;
      }
      root.environmentNode = previous;
      scene.invalidate();
    };
  }, [scene, slots]);

  // Later changes fade on the same node.
  const key = JSON.stringify(options);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!node) return;
    if (shown.current !== null && shown.current !== key) {
      scene.diagnostics.note("environment", { fade: latest.current.transition });
      node.light.set(latest.current.options, latest.current.transition);
      scene.invalidate();
    }
    shown.current = key;
  }, [node, key, scene]);

  const readRotation = useAnimatable(rotation);
  const readIntensity = useAnimatable(intensity);
  useFrame(({ delta }) => {
    if (!node) return false;
    node.light.rotation.value = readRotation();
    node.light.gain.value = readIntensity();
    return node.light.step(delta);
  });
  return null;
}
