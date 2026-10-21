import { Backdrop, CARD_FINISHES, CARD_SIZE, Card, type CardFinish } from "@apricotjs/assets";
import { FitCamera, Group, Scene } from "@apricotjs/react-native";
import { useTextureState } from "@apricotjs/react-native/model";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCardMotion } from "../../../../recipes/card-tilt/useCardMotion";
import { SceneLoading } from "../ui/SceneLoading";

const ART = require("../../assets/images/card-art.png");
const FINISHES = Object.keys(CARD_FINISHES) as CardFinish[];

// A payment card in seven finishes under the studio environment, in front of a backdrop that the glass
// finish refracts. The status line shows whether the engraving PNG loaded.
export default function MetalCard() {
  const { gesture, rotation } = useCardMotion();
  const { texture: art, error } = useTextureState(ART);
  const [finish, setFinish] = useState<CardFinish>("brushed-steel");
  const insets = useSafeAreaInsets();
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
            camera={{ position: [0, 0, 7.5], fov: 35 }}
            debug
          >
            <FitCamera size={[CARD_SIZE.width, CARD_SIZE.height]} margin={0.12} />
            <Backdrop position={[0, 0, -3]} />
            <Group rotation={rotation}>
              <Card finish={finish} art={art} />
            </Group>
          </Scene>
        </View>
      </GestureDetector>
      <Text style={styles.hint}>Drag to turn · tilt the phone</Text>
      <Text style={[styles.hint, error ? styles.error : null]}>
        {error
          ? `Engraving failed to load: ${error.message}`
          : art
            ? `Engraving: ${(art.image as { width: number }).width}×${(art.image as { height: number }).height} PNG`
            : "Engraving: loading…"}
      </Text>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={[styles.chips, { paddingBottom: 16 + insets.bottom }]}
        showsHorizontalScrollIndicator={false}
      >
        {FINISHES.map((name) => (
          <Pressable
            key={name}
            onPress={() => setFinish(name)}
            style={[styles.chip, name === finish && styles.chipActive]}
          >
            <Text style={[styles.chipText, name === finish && styles.chipTextActive]}>
              {CARD_FINISHES[name].label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0f12" },
  hint: { color: "#8b9099", textAlign: "center", fontSize: 13, marginBottom: 8 },
  error: { color: "#ff8a80" },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "#1c1e23" },
  chipActive: { backgroundColor: "#f1f3f5" },
  chipText: { color: "#c9cdd3", fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#0e0f12" },
});
