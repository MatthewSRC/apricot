// Apricot recipe: swipe-to-spin
// Copy this file into your app. A horizontal swipe rotates whatever you wrap in
// <Group rotation={rotation}>. On release it keeps turning and slows down with withDecay.
// Everything runs on the UI thread.
import { Gesture } from "react-native-gesture-handler";
import { cancelAnimation, useDerivedValue, useSharedValue, withDecay } from "react-native-reanimated";

export interface SwipeRotationOptions {
  /** Radians per point of finger movement (default 0.012). */
  sensitivity?: number;
  /** Deceleration passed to withDecay. Values closer to 1 coast longer (default 0.997). */
  deceleration?: number;
}

/** Returns a pan gesture, a y rotation for a <Group> and the underlying angle in radians. */
export function useSwipeRotation({ sensitivity = 0.012, deceleration = 0.997 }: SwipeRotationOptions = {}) {
  const angle = useSharedValue(0);
  const rotation = useDerivedValue<readonly [number, number, number]>(() => [0, angle.value, 0]);
  const gesture = Gesture.Pan()
    .onBegin(() => {
      cancelAnimation(angle);
    })
    .onChange((event) => {
      angle.value += event.changeX * sensitivity;
    })
    .onEnd((event) => {
      angle.value = withDecay({ velocity: event.velocityX * sensitivity, deceleration });
    });
  return { gesture, rotation, angle };
}
