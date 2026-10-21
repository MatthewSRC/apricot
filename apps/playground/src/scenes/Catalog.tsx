import { CameraRig, Scene } from "@apricotjs/react-native";
import { Model, type ModelSource } from "@apricotjs/react-native/model";
import { memo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneLoading } from "../ui/SceneLoading";

// A catalog with one large stage and a row of tiles. Tapping a tile changes the stage's <Model src>, and the
// camera flies to frame the new item.

interface Item {
  id: string;
  title: string;
  src: ModelSource;
}

const ITEMS: Item[] = [
  { id: "laptop", title: "Laptop", src: require("../../assets/models/laptop.glb") },
  { id: "chair", title: "Velvet chair", src: require("../../assets/models/velvet-chair.glb") },
  { id: "sedan", title: "Sedan", src: require("../../assets/models/sedan.glb") },
  { id: "car", title: "Toy car", src: require("../../assets/models/car.glb") },
];

const STAGE = "#efe7de";
const TILE = "#f7f2ec";

const Stage = memo(function Stage({ item, onShown }: { item: Item; onShown: (src: ModelSource) => void }) {
  return (
    <Scene
      loading={<SceneLoading background={STAGE} color="#5b4636" />}
      style={StyleSheet.absoluteFill}
      background={STAGE}
      debug
    >
      <Model src={item.src} onReady={(_, src) => onShown(src)}>
        <CameraRig view="three-quarter" orbit={{ returnAfter: 3 }} transition={0.6} margin={0.15} />
      </Model>
    </Scene>
  );
});

interface TileProps {
  item: Item;
  chosen: boolean;
  onPress: (id: string) => void;
}

const Tile = memo(function Tile({ item, chosen, onPress }: TileProps) {
  return (
    <Pressable
      style={[styles.tile, chosen && styles.chosen]}
      onPress={() => onPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      {/* The tile handles the tap instead of its scene. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Scene
          loading={
            <View style={styles.tileLoading}>
              <ActivityIndicator color="#8a7462" />
            </View>
          }
          style={StyleSheet.absoluteFill}
          background={TILE}
        >
          <Model src={item.src}>
            <CameraRig view="three-quarter" margin={0.05} />
          </Model>
        </Scene>
      </View>
      <Text style={styles.label}>{item.title}</Text>
    </Pressable>
  );
});

export default function Catalog() {
  const insets = useSafeAreaInsets();
  const [chosen, setChosen] = useState(ITEMS[0]?.id ?? "");
  const item = ITEMS.find((i) => i.id === chosen) ?? (ITEMS[0] as Item);
  const [status, setStatus] = useState("Tap an item below");
  const tappedAt = useRef<{ id: string; at: number } | null>(null);
  // Stable, so the memoised tiles and stage don't re-render on a tap.
  const [onPress] = useState(() => (id: string) => {
    tappedAt.current = { id, at: performance.now() };
    setChosen(id);
  });
  const [onShown] = useState(() => (src: ModelSource) => {
    const tap = tappedAt.current;
    const shown = ITEMS.find((i) => i.src === src);
    if (!tap || tap.id !== shown?.id) return;
    tappedAt.current = null;
    setStatus(`${shown.title} shown ${Math.round(performance.now() - tap.at)} ms after the tap`);
  });

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.stage}>
        <Stage item={item} onShown={onShown} />
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.row}>
        {ITEMS.map((i) => (
          <Tile key={i.id} item={i} chosen={i.id === chosen} onPress={onPress} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: STAGE, padding: 16, gap: 10 },
  stage: { flex: 1, borderRadius: 24, overflow: "hidden", backgroundColor: STAGE },
  title: { fontSize: 20, fontWeight: "700", color: "#3b2c22", textAlign: "center" },
  status: { fontSize: 13, color: "#7a6556", textAlign: "center" },
  row: { flexDirection: "row", gap: 8, height: 104 },
  tile: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: TILE,
  },
  chosen: { borderColor: "#c58a5c" },
  tileLoading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: TILE },
  label: { position: "absolute", bottom: 4, alignSelf: "center", fontSize: 10, color: "#5b4636" },
});
