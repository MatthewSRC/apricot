import { Stack, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { SCENES } from "@/scenes";

export default function SceneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = SCENES.find((s) => s.id === id);
  if (!entry) return <Text style={{ color: "#f1f5f9", padding: 16 }}>Unknown scene {id}</Text>;
  const Component = entry.component;
  return (
    <>
      <Stack.Screen options={{ title: entry.title }} />
      <Component />
    </>
  );
}
