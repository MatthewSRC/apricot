import { createPeach, Peach } from "@apricotjs/assets";
import { disposeObject, seededRandom } from "@apricotjs/core";
import {
  Blur,
  DirectionalLight,
  FitCamera,
  Group,
  HemisphereLight,
  type InstanceItem,
  Instances,
  type InstancesHandle,
  Scene,
  Spin,
  useFrame,
} from "@apricotjs/react-native";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSwipeRotation } from "../../../../recipes/swipe-to-spin/useSwipeRotation";
import { SceneLoading } from "../ui/SceneLoading";

// A large peach to spin with a swipe, with smaller blurred peaches falling behind it.

const FALLING = 36;

interface Faller {
  x: number;
  y: number;
  z: number;
  speed: number;
  spin: [number, number, number];
  phase: [number, number, number];
  scale: number;
}

/** Start positions, depths and speeds for the falling peaches. */
const scatter = (): Faller[] => {
  const random = seededRandom(11);
  return Array.from({ length: FALLING }, () => {
    const z = -2.5 - random() * 8;
    // Wider spread further back, so they fill the screen at every depth.
    const spread = 2.2 + -z * 0.42;
    return {
      x: (random() * 2 - 1) * spread,
      y: (random() * 2 - 1) * (4 + -z * 0.5),
      z,
      speed: 0.5 + random() * 0.7,
      spin: [random() * 1.6 - 0.8, random() * 1.6 - 0.8, random() * 1.2 - 0.6],
      phase: [random() * 6, random() * 6, random() * 6],
      scale: 0.38 + random() * 0.3,
    };
  });
};

/** Peaches that tumble down and wrap round to the top, drawn as instances in one draw call per part. */
function FallingPeaches() {
  // The peaches are small and blurred, so a low-detail mesh is enough.
  const peach = useMemo(() => createPeach({ detail: 0.15 }), []);
  useEffect(() => () => disposeObject(peach), [peach]);
  const fallers = useMemo(scatter, []);
  const items = useMemo<InstanceItem[]>(
    () => fallers.map((f) => ({ position: [f.x, f.y, f.z], scale: f.scale })),
    [fallers],
  );
  const copies = useRef<InstancesHandle>(null);
  const time = useRef(0);
  useFrame(({ delta }) => {
    const handle = copies.current;
    if (!handle) return true;
    time.current += delta;
    const t = time.current;
    fallers.forEach((f, i) => {
      const height = 4 + -f.z * 0.5;
      f.y -= f.speed * delta;
      if (f.y < -height) f.y += height * 2;
      handle.set(i, {
        position: [f.x + Math.sin(t * 0.6 + f.phase[0]) * 0.15, f.y, f.z],
        rotation: [f.phase[0] + t * f.spin[0], f.phase[1] + t * f.spin[1], f.phase[2] + t * f.spin[2]],
        scale: f.scale,
      });
    });
    return true;
  });
  return <Instances ref={copies} object={peach} items={items} />;
}

export default function PeachHero() {
  const { gesture, rotation } = useSwipeRotation();
  const insets = useSafeAreaInsets();
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.screen}>
        <Scene
          loading={<SceneLoading />}
          style={StyleSheet.absoluteFill}
          look="none"
          background="#ffffff"
          camera={{ position: [0, 0, 8], target: [0, 0, 0], fov: 35 }}
        >
          <Blur radius={4}>
            <FallingPeaches />
          </Blur>
          {/* Key light from the top left, fill from the right, red bounce from below, rim from behind. */}
          <HemisphereLight sky="#ffe6cc" ground="#c83020" intensity={2} />
          <DirectionalLight position={[-2, 4, 5]} intensity={2.1} color="#ffe8cc" />
          <DirectionalLight position={[4, 1.5, 5]} intensity={0.9} color="#ffdcc0" />
          <DirectionalLight position={[-4, 2, -4]} intensity={1.6} color="#ffd8cc" />
          {/* Fits the large peach to about 60% of the screen width. */}
          <FitCamera size={[1.8, 1.8]} margin={0.1} />
          <Spin speed={0.35}>
            <Group rotation={rotation}>
              <Peach size={1.1} rotation={[0.15, 0, 0]} />
            </Group>
          </Spin>
        </Scene>
        <Text style={[styles.hint, { bottom: 24 + insets.bottom }]}>Swipe sideways to spin</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  hint: { position: "absolute", alignSelf: "center", color: "#9a8f86", fontSize: 14, fontWeight: "600" },
});
