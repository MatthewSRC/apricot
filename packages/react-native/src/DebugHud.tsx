import type { ApricotScene, FrameStats } from "@apricotjs/core";
import { useEffect, useState } from "react";
import { Dimensions, PixelRatio, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";

/** The scene's performance report with the device's details, as JSON text. */
export const diagnosticsJson = (scene: ApricotScene, extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    scene.report({
      device: {
        os: Platform.OS,
        version: Platform.Version,
        pixelRatio: PixelRatio.get(),
        screen: Dimensions.get("screen"),
      },
      ...extra,
    }),
  );

/**
 * Shares the performance report through the share sheet. Where sharing is not
 * available, as in some browsers, the report is logged instead.
 */
export const shareDiagnostics = async (scene: ApricotScene, extra?: Record<string, unknown>) => {
  const message = diagnosticsJson(scene, extra);
  try {
    await Share.share({ message, title: "Apricot diagnostics" });
  } catch {
    console.log("[apricot] diagnostics:", message);
  }
};

/**
 * Shows fps, render and present time (and GPU time when the scene measures
 * it), refreshed twice a second, and a Share button for the full performance
 * report.
 */
export const DebugHud = ({ stats, scene }: { stats: FrameStats; scene?: ApricotScene }) => {
  const [live, setLive] = useState(() => ({ ...stats.live(), gpuMs: scene?.gpuMs ?? null }));
  useEffect(() => {
    const id = setInterval(() => setLive({ ...stats.live(), gpuMs: scene?.gpuMs ?? null }), 500);
    return () => clearInterval(id);
  }, [stats, scene]);
  return (
    <View style={styles.hud}>
      <Text style={styles.text}>
        {live.fps.toFixed(0)} fps · render {live.renderMs.toFixed(1)} ms · present {live.presentMs.toFixed(1)}{" "}
        ms
        {live.gpuMs !== null ? ` · gpu ${live.gpuMs.toFixed(1)} ms` : ""}
      </Text>
      {scene ? (
        <Pressable
          onPress={() => void shareDiagnostics(scene)}
          style={styles.button}
          accessibilityLabel="Share diagnostics"
        >
          <Text style={styles.text}>Share</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  hud: {
    position: "absolute",
    pointerEvents: "box-none",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  text: { color: "#fff", fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  button: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
});
