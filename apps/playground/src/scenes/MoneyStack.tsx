import { Coin, MoneyStack } from "@apricotjs/assets";
import { Group, Scene, Spin } from "@apricotjs/react-native";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSwipeRotation } from "../../../../recipes/swipe-to-spin/useSwipeRotation";
import { SceneLoading } from "../ui/SceneLoading";

// A stack of money that spins on its own and can be flung with a swipe.
export default function MoneyStackScene() {
  const { gesture, rotation } = useSwipeRotation();
  const insets = useSafeAreaInsets();
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ flex: 1 }}>
        <Scene
          loading={<SceneLoading />}
          style={{ flex: 1 }}
          look="soft"
          camera={{ position: [0, 3, 7.4], target: [0, 0.45, 0] }}
          debug
        >
          <Spin speed={0.6}>
            <Group rotation={rotation}>
              <MoneyStack bills={40} />
              <Coin position={[-0.62, 0.97, 0.08]} rotation={[0.1, 0, -0.06]} radius={0.38} />
              <Coin position={[0.55, 0.04, 1.12]} />
            </Group>
          </Spin>
        </Scene>
        <Text style={[styles.hint, { bottom: 24 + insets.bottom }]}>Swipe sideways to spin</Text>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hint: { position: "absolute", alignSelf: "center", color: "#6b5e52", fontSize: 14, fontWeight: "600" },
});
