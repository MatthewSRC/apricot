import type { Vec3 } from "@apricotjs/core";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from "react-native";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { optional, type ReanimatedModule } from "./optional";
import { type SceneObject, useParent } from "./parent";

export interface LabelProps {
  /** The object to follow, as a ref or the object itself, such as a train car. */
  attach?: RefObject<SceneObject | null> | SceneObject | null;
  /**
   * Where the label is pinned, in its parent's space: a <Group>'s, or the
   * world's at the top of the scene. With `attach`, an offset from the object
   * along world axes, so a label stays above a turning car. Default [0, 0, 0].
   */
  position?: Vec3;
  /**
   * Which part of the label sits on the point: "bottom" (default, so the
   * label floats above it like a map pin), "center" or "top".
   */
  anchor?: "bottom" | "center" | "top";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const point = new THREE.Vector3();
const view = new THREE.Vector3();

const objectOf = (attach: LabelProps["attach"]) =>
  attach && "current" in attach ? attach.current : (attach ?? null);

/** A label's position in points from the scene's top-left, and its opacity (0 or 1). */
interface Spot {
  x: number;
  y: number;
  visible: number;
}

/** Works out the label's screen position each frame, and calls `show` when it changes. */
function useSpot({ attach, position = [0, 0, 0] }: LabelProps, show: (spot: Spot) => void) {
  const scene = useScene();
  const parent = useParent();
  const last = useRef<Spot>({ x: Number.NaN, y: Number.NaN, visible: -1 });
  useFrame(() => {
    const object = objectOf(attach);
    const previous = last.current;
    if (object) {
      object.updateWorldMatrix(true, false);
      object.getWorldPosition(point).add({ x: position[0], y: position[1], z: position[2] });
    } else if (attach) {
      if (previous.visible !== 0) {
        last.current = { ...previous, visible: 0 };
        show(last.current);
      }
      return;
    } else {
      point.set(position[0], position[1], position[2]);
      parent.updateWorldMatrix(true, false);
      parent.localToWorld(point);
    }
    scene.camera.updateMatrixWorld();
    const ahead = view.copy(point).applyMatrix4(scene.camera.matrixWorldInverse).z < 0;
    point.project(scene.camera);
    const { width: w, height: h } = scene.size;
    const screenX = Math.round(((point.x + 1) / 2) * w * 10) / 10;
    const screenY = Math.round(((1 - point.y) / 2) * h * 10) / 10;
    const shown = scene.ready && ahead && Math.abs(point.x) < 1.5 && Math.abs(point.y) < 1.5 ? 1 : 0;
    if (screenX === previous.x && screenY === previous.y && shown === previous.visible) return;
    last.current = { x: screenX, y: screenY, visible: shown };
    show(last.current);
  });
}

const offsetOf = (anchor: LabelProps["anchor"], height: number) =>
  anchor === "bottom" ? height : anchor === "center" ? height / 2 : 0;

/**
 * A React Native view pinned to a point in the 3D scene, such as a name over
 * a station or "Your train · 0:25" over a moving train. It can hold any views
 * and hides when the point is behind the camera. Put it inside <Scene>. With
 * Reanimated installed it moves on the UI thread with no React render per
 * frame. Without Reanimated it re-renders as it moves, which is fine for a
 * few labels.
 *
 *   <Label attach={leadCar} position={[0, 4, 0]}><Pill>Your train · 0:25</Pill></Label>
 */
export function Label(props: LabelProps) {
  // Reanimated is installed or not for the whole run, so this choice never changes.
  return optional.reanimated ? (
    <MovedOnUiThread {...props} reanimated={optional.reanimated} />
  ) : (
    <MovedByReact {...props} />
  );
}

function MovedOnUiThread({ reanimated, ...props }: LabelProps & { reanimated: ReanimatedModule }) {
  const { anchor = "bottom", style, children } = props;
  const { useSharedValue, useAnimatedStyle } = reanimated;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const visible = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  useSpot(props, (spot) => {
    x.value = spot.x;
    y.value = spot.y;
    visible.value = spot.visible;
  });
  // Runs on the UI thread as a worklet, so it cannot call functions from this module.
  const moved = useAnimatedStyle(() => {
    "worklet";
    const dy = anchor === "bottom" ? height.value : anchor === "center" ? height.value / 2 : 0;
    return {
      opacity: visible.value,
      transform: [{ translateX: x.value - width.value / 2 }, { translateY: y.value - dy }],
    };
  });
  const measure = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width;
    height.value = event.nativeEvent.layout.height;
  };
  const Moving = reanimated.default.View as typeof View;
  return (
    <Moving style={[PINNED, style, moved]} onLayout={measure}>
      {children}
    </Moving>
  );
}

function MovedByReact(props: LabelProps) {
  const { anchor = "bottom", style, children } = props;
  const [spot, setSpot] = useState<Spot>({ x: 0, y: 0, visible: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  useSpot(props, setSpot);
  const moved = {
    opacity: spot.visible,
    transform: [
      { translateX: spot.x - size.width / 2 },
      { translateY: spot.y - offsetOf(anchor, size.height) },
    ],
  };
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };
  return (
    <View style={[PINNED, style, moved]} onLayout={measure}>
      {children}
    </View>
  );
}

const PINNED: ViewStyle = { position: "absolute", left: 0, top: 0, pointerEvents: "box-none" };
