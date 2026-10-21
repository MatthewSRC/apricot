import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SCENES } from "@/scenes";

export default function Home() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}>
      {SCENES.map((scene) => (
        <Link key={scene.id} href={{ pathname: "/scene/[id]", params: { id: scene.id } }} asChild>
          <Pressable style={styles.card}>
            <Text style={styles.title}>{scene.title}</Text>
            <Text style={styles.summary}>{scene.summary}</Text>
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  card: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#263043", backgroundColor: "#151b27" },
  title: { color: "#f1f5f9", fontSize: 17, fontWeight: "600" },
  summary: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
});
