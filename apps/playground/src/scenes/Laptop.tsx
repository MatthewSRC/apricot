import { StudioFloor } from "@apricotjs/assets";
import { CameraRig, Scene } from "@apricotjs/react-native";
import { defineModelKit, Model } from "@apricotjs/react-native/model";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { cancelAnimation, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneLoading } from "../ui/SceneLoading";

// A laptop lid opened by dragging, either through a joint or by scrubbing the "LidOpen" animation in the
// .glb. It springs shut on release.
const laptop = defineModelKit(require("../../assets/models/laptop.glb"), {
  lid: { select: "lid", hinge: "bottom-back", axis: "x", range: [0, -110] },
  body: "material:aluminium",
  screen: "material:screen",
});

const VIEW = { azimuth: 20, elevation: 22, distance: 7.5, target: [0, 0.7, 0] as const };

export default function Laptop() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"animation" | "joint">("animation");
  const open = useSharedValue(0);
  const start = useSharedValue(0);
  const gesture = Gesture.Pan()
    .onBegin(() => {
      cancelAnimation(open);
      start.value = open.value;
    })
    .onUpdate((e) => {
      open.value = Math.min(1, Math.max(0, start.value - e.translationY / 260));
    })
    .onFinalize(() => {
      open.value = withSpring(0, { damping: 16, stiffness: 140, overshootClamping: true });
    });
  return (
    <View style={styles.screen}>
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }}>
          <Scene
            loading={<SceneLoading />}
            style={{ flex: 1 }}
            look="none"
            environment="studio"
            background="#0e0f12"
            debug
          >
            <StudioFloor radius={6} />
            <Model
              kit={laptop}
              materials={{ body: "aluminium", screen: { preset: "light", color: "#3a6df0" } }}
              animations={mode === "animation" ? { LidOpen: open } : undefined}
              joints={mode === "joint" ? { lid: open } : undefined}
            >
              <CameraRig view={VIEW} subject={null} />
            </Model>
          </Scene>
        </View>
      </GestureDetector>
      <Text style={styles.hint}>Drag up to open the lid · let go and it springs shut</Text>
      <View style={[styles.row, { paddingBottom: 16 + insets.bottom }]}>
        {(["animation", "joint"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[styles.chip, m === mode && styles.chipActive]}
          >
            <Text style={[styles.chipText, m === mode && styles.chipTextActive]}>
              {m === "animation" ? "Blender animation" : "Joint"}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0f12" },
  hint: { color: "#8b9099", textAlign: "center", fontSize: 13, marginBottom: 10 },
  row: { flexDirection: "row", gap: 8, justifyContent: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "#1c1e23" },
  chipActive: { backgroundColor: "#f1f3f5" },
  chipText: { color: "#c9cdd3", fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#111214" },
});
