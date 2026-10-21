import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0b0f17" },
          headerTintColor: "#f1f5f9",
          contentStyle: { backgroundColor: "#0b0f17" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Apricot playground" }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
