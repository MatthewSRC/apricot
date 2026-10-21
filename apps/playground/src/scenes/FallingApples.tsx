import { Apple } from "@apricotjs/assets";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FallingPileOverlay } from "../../../../recipes/falling-pile/FallingPileOverlay";

const MESSAGES = [
  ["Ana", "Lunch on Friday? 🍎"],
  ["Build bot", "All checks passed"],
  ["Marco", "Sent you the slides"],
  ["Calendar", "Stand-up in 10 minutes"],
  ["Jun", "Photos from the trip"],
  ["Bank", "Your statement is ready"],
  ["Lea", "Can you review my PR?"],
  ["News", "Weekly digest"],
] as const;

// Apples drop over an ordinary screen for 5 seconds and pile up at the bottom, while the list underneath
// stays scrollable and tappable.
export default function FallingApples() {
  const insets = useSafeAreaInsets();
  const [run, setRun] = useState(0);
  const [settled, setSettled] = useState(false);
  const [taps, setTaps] = useState(0);
  return (
    <FallingPileOverlay
      key={run}
      count={45}
      duration={5}
      items={<Apple />}
      onSettled={() => setSettled(true)}
      debug
    >
      <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}>
        <View style={styles.header}>
          <Text style={styles.title}>Inbox</Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              setSettled(false);
              setRun((n) => n + 1);
            }}
          >
            <Text style={styles.buttonText}>Drop again</Text>
          </Pressable>
        </View>
        <Text style={styles.status}>
          {settled ? "Settled: the 3D layer has stopped rendering." : "Dropping…"} Taps on rows: {taps}
        </Text>
        {MESSAGES.map(([from, text]) => (
          <Pressable key={from} style={styles.row} onPress={() => setTaps((n) => n + 1)}>
            <Text style={styles.from}>{from}</Text>
            <Text style={styles.text}>{text}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </FallingPileOverlay>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f5f7" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  title: { fontSize: 28, fontWeight: "700", color: "#1f2328" },
  button: { backgroundColor: "#1f2328", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  buttonText: { color: "#fff", fontWeight: "600" },
  status: { marginHorizontal: 16, marginBottom: 8, color: "#6a737d", fontSize: 13 },
  row: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e3e5ea",
  },
  from: { fontWeight: "700", color: "#1f2328", marginBottom: 4 },
  text: { color: "#4a525c" },
});
