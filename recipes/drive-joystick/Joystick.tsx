// Apricot recipe: drive-joystick
// Copy this file into your app. An on-screen thumbstick writes throttle and steering into Reanimated
// shared values on the UI thread. Pass them to <Vehicle throttle steer>.
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

export interface JoystickValues {
  /** -1 (back) to 1 (forward). */
  throttle: SharedValue<number>;
  /** -1 (left) to 1 (right). */
  steer: SharedValue<number>;
}

/** Creates the shared values a <Joystick> writes and a <Vehicle> reads. */
export function useJoystickValues(): JoystickValues {
  return { throttle: useSharedValue(0), steer: useSharedValue(0) };
}

export interface JoystickProps extends JoystickValues {
  /** Radius of the knob travel in points (default 56). */
  radius?: number;
  style?: ViewStyle;
}

/** An on-screen thumbstick. Up is forward and right steers right. */
export function Joystick({ throttle, steer, radius = 56, style }: JoystickProps) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const gesture = Gesture.Pan()
    .minDistance(0)
    .onChange((event) => {
      // Keeps the knob inside the ring.
      const length = Math.hypot(event.translationX, event.translationY);
      const scale = length > radius ? radius / length : 1;
      x.value = event.translationX * scale;
      y.value = event.translationY * scale;
      steer.value = x.value / radius;
      throttle.value = -y.value / radius;
    })
    .onFinalize(() => {
      x.value = withSpring(0);
      y.value = withSpring(0);
      steer.value = 0;
      throttle.value = 0;
    });
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  const size = radius * 2 + 48;
  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }, style]}>
        <Animated.View style={[styles.knob, knob]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.35)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.7)",
  },
  knob: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
  },
});
