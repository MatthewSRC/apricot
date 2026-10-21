// Apricot recipe: card-tilt
// Copy this file into your app. Dragging turns a card, and on release it settles on its front or back,
// so a fling flips it. Tilting the phone leans the card a little so its reflections move.
// Everything runs on the UI thread.
import { Gesture } from "react-native-gesture-handler";
import {
  cancelAnimation,
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

export interface CardMotionOptions {
  /** Largest lean from tilting the phone, in radians (default 0.35). */
  tilt?: number;
  /** Radians per point of drag (default 0.01). */
  sensitivity?: number;
}

const clamp = (value: number, limit: number) => {
  "worklet";
  return Math.min(limit, Math.max(-limit, value));
};

// Rounds to 0.002 rad steps so a phone lying still produces no changes and the scene can stop rendering.
const quantize = (value: number) => {
  "worklet";
  return Math.round(value * 500) / 500;
};

/** Returns a pan gesture and a rotation for the card, driven by dragging and by phone tilt. */
export function useCardMotion({ tilt = 0.35, sensitivity = 0.01 }: CardMotionOptions = {}) {
  const yaw = useSharedValue(0);
  const pitch = useSharedValue(0);
  const leanX = useSharedValue(0);
  const leanY = useSharedValue(0);
  const neutral = useSharedValue<{ pitch: number; roll: number } | null>(null);
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: "auto" });

  useAnimatedReaction(
    () => sensor.sensor.value,
    (reading) => {
      if (!neutral.value) {
        neutral.value = { pitch: reading.pitch, roll: reading.roll };
        return;
      }
      // Re-centres slowly, so whatever angle the phone is held at becomes neutral.
      const base = {
        pitch: neutral.value.pitch + (reading.pitch - neutral.value.pitch) * 0.01,
        roll: neutral.value.roll + (reading.roll - neutral.value.roll) * 0.01,
      };
      neutral.value = base;
      const x = clamp((reading.pitch - base.pitch) * 0.9, tilt);
      const y = clamp((reading.roll - base.roll) * 0.9, tilt);
      // Smooths out sensor noise.
      leanX.value += (x - leanX.value) * 0.25;
      leanY.value += (y - leanY.value) * 0.25;
    },
  );

  const gesture = Gesture.Pan()
    .onBegin(() => {
      cancelAnimation(yaw);
      cancelAnimation(pitch);
    })
    .onChange((event) => {
      yaw.value += event.changeX * sensitivity;
      pitch.value = clamp(pitch.value + event.changeY * sensitivity, 0.6);
    })
    .onEnd((event) => {
      // Settles on the nearest side and keeps the fling velocity.
      const velocity = event.velocityX * sensitivity;
      const side = Math.round((yaw.value + velocity * 0.15) / Math.PI) * Math.PI;
      yaw.value = withSpring(side, { velocity, damping: 14, stiffness: 120 });
      pitch.value = withSpring(0, { damping: 14 });
    });

  const rotation = useDerivedValue<readonly [number, number, number]>(() => [
    quantize(pitch.value + leanX.value),
    quantize(yaw.value + leanY.value),
    0,
  ]);
  return { gesture, rotation };
}
