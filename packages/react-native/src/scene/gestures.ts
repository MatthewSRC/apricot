import type { ApricotScene } from "@apricotjs/core";
import { type RefObject, useEffect, useRef } from "react";
import { type GestureResponderEvent, Platform, type View, type ViewProps } from "react-native";
import type { SceneTouches, SceneTouchListener } from "../touches";

// A tap is one finger lifted within TAP_SLOP points and TAP_TIME ms of where it went down.
const TAP_SLOP = 10;
const TAP_TIME = 500;

const timeOf = (event: GestureResponderEvent) =>
  typeof event.nativeEvent.timestamp === "number" ? event.nativeEvent.timestamp : performance.now();

/**
 * Handlers for the view that holds a scene. Taps go to `scene.press` (part
 * presses, the inspector). Drags, pinches and the mouse wheel go to the
 * listeners in `touches`, such as <CameraRig orbit>.
 *
 * `dragProps` are responder handlers. `tapProps` replace `onTouchStart` and
 * `onTouchEnd` on native (calling the given ones too) and add `onClick` on the
 * web.
 */
export function useSceneGestures(
  outer: RefObject<View | null>,
  touches: SceneTouches,
  scene: RefObject<ApricotScene | null>,
  { onTouchStart, onTouchEnd }: Pick<ViewProps, "onTouchStart" | "onTouchEnd">,
) {
  // Touch events only observe, so gesture handlers around the scene keep working.
  const tapStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const handleTouchStart = (event: GestureResponderEvent) => {
    const { locationX, locationY, touches: fingers, timestamp } = event.nativeEvent;
    tapStart.current = fingers.length > 1 ? null : { x: locationX, y: locationY, time: timestamp };
    onTouchStart?.(event);
  };
  const handleTouchEnd = (event: GestureResponderEvent) => {
    const start = tapStart.current;
    tapStart.current = null;
    const { locationX, locationY, timestamp } = event.nativeEvent;
    if (
      start &&
      Math.hypot(locationX - start.x, locationY - start.y) < TAP_SLOP &&
      timestamp - start.time < TAP_TIME
    )
      scene.current?.press(locationX, locationY);
    onTouchEnd?.(event);
  };

  // How far the last drag moved, so the click that ends it is not taken as a tap.
  const dragged = useRef(0);
  // The scene's top-left on the page for the current gesture. Fingers arrive in page points.
  const origin = useRef({ x: 0, y: 0 });
  // A listener that captured the current gesture (such as an object picked up) receives it alone.
  const owner = useRef<SceneTouchListener | null>(null);
  const pointsOf = (event: GestureResponderEvent) =>
    event.nativeEvent.touches.map((t) => ({ x: t.pageX - origin.current.x, y: t.pageY - origin.current.y }));
  const listeners = () => (owner.current ? [owner.current] : touches);
  const forward = (event: GestureResponderEvent) => {
    const points = pointsOf(event);
    if (points.length === 0) return;
    for (const listener of listeners()) listener.touch(points, timeOf(event));
    scene.current?.invalidate();
  };
  const begin = (event: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = event.nativeEvent;
    origin.current =
      typeof pageX === "number" && typeof locationX === "number"
        ? { x: pageX - locationX, y: pageY - locationY }
        : { x: 0, y: 0 };
    const points = pointsOf(event);
    owner.current = null;
    for (const listener of touches) {
      if (listener.capture?.(points, timeOf(event))) {
        owner.current = listener;
        break;
      }
    }
    forward(event);
  };
  const lift = (event: GestureResponderEvent) => {
    let moved = 0;
    for (const listener of listeners()) moved = Math.max(moved, listener.release(timeOf(event)));
    owner.current = null;
    dragged.current = moved;
    scene.current?.invalidate();
  };
  const dragProps = {
    // Claim only touches that start on the scene itself, and only when something listens. Claiming
    // on move instead would cancel presses on buttons over the scene when the finger wobbles.
    onStartShouldSetResponder: () => touches.size > 0,
    // A parent must not take over a drag half-way.
    onResponderTerminationRequest: () => false,
    // Returning true stops scroll views and pagers on Android from taking the drag.
    onResponderGrant: (event: GestureResponderEvent) => {
      begin(event);
      return true;
    },
    onResponderStart: forward,
    onResponderMove: forward,
    // One finger lifted while others stay down.
    onResponderEnd: (event: GestureResponderEvent) => {
      if (event.nativeEvent.touches.length > 0) forward(event);
    },
    onResponderRelease: lift,
    onResponderTerminate: lift,
  };

  // react-native-web does not forward onWheel, so listen on the DOM element.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const element = outer.current as unknown as HTMLElement | null;
    if (!element?.addEventListener) return;
    const wheel = (event: WheelEvent) => {
      if (touches.size === 0) return;
      event.preventDefault();
      for (const listener of touches) listener.wheel?.(event.deltaY);
      scene.current?.invalidate();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [touches, outer, scene]);

  // On the web a click is a tap, for mouse and touch alike, unless it ended a drag.
  const handleClick = (event: { nativeEvent: { offsetX: number; offsetY: number } }) => {
    if (dragged.current >= TAP_SLOP) {
      dragged.current = 0;
      return;
    }
    scene.current?.press(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
  };
  const tapProps =
    Platform.OS === "web"
      ? { onClick: handleClick }
      : { onTouchStart: handleTouchStart, onTouchEnd: handleTouchEnd };

  return { dragProps, tapProps };
}
