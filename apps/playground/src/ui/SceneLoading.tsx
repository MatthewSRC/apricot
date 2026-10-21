import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

/**
 * A loading cover for <Scene loading>. It hides the blank canvas while the GPU starts and the
 * background-only frames while shaders compile.
 */
export function SceneLoading({
  background = "#14161b",
  color = "#ffffff",
}: {
  background?: string;
  color?: string;
}) {
  return (
    <View style={[styles.cover, { backgroundColor: background }]}>
      <ActivityIndicator color={color} />
      <Text style={[styles.text, { color }]}>Loading scene…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  text: { fontSize: 13, opacity: 0.7 },
});
