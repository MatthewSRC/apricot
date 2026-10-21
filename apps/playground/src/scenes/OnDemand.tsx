import { Box, Scene, type SceneObject, useFrame, useScene } from "@apricotjs/react-native";
import { useEffect, useReducer, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneLoading } from "../ui/SceneLoading";

// On-demand rendering: each tap adds spin that decays to zero. useFrame returns true while the cube spins,
// so the loop renders only until it stops.
function DecayingSpin({ kicks }: { kicks: number }) {
  const scene = useScene();
  const cube = useRef<SceneObject>(null);
  const speed = useRef(0);

  useEffect(() => {
    if (kicks === 0) return;
    speed.current += 6;
    scene.invalidate();
  }, [kicks, scene]);

  useFrame(({ delta }) => {
    if (!cube.current || speed.current === 0) return false;
    cube.current.rotation.y += speed.current * delta;
    // Loses about 96% of its speed per second.
    speed.current *= 0.04 ** delta;
    if (speed.current < 0.01) speed.current = 0;
    return speed.current > 0;
  });

  return <Box ref={cube} size={1.6} color="#7cc4a4" />;
}

export default function OnDemand() {
  const [kicks, kick] = useReducer((n: number) => n + 1, 0);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Scene loading={<SceneLoading />} style={{ flex: 1 }} debug>
        <DecayingSpin kicks={kicks} />
      </Scene>
      <Pressable style={[styles.button, { bottom: 32 + insets.bottom }]} onPress={kick}>
        <Text style={styles.label}>Spin</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#ff9f59",
  },
  label: { color: "#0b0f17", fontSize: 16, fontWeight: "700" },
});
