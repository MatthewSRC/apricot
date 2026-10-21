import { seededRandom } from "@apricotjs/core";
import { Box, CameraRig, type InstanceItem, Instances, Plane, Scene } from "@apricotjs/react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneLoading } from "../ui/SceneLoading";

// A cinema seat picker with 448 seats drawn as instances of one two-part seat, coloured by state.

const ROWS = 16;
const PER_ROW = 28;

interface Seat extends InstanceItem {
  id: string;
  taken: boolean;
}

/** Rows curve round the screen and step up towards the back. */
const layout = (): Seat[] => {
  const random = seededRandom(7);
  const seats: Seat[] = [];
  for (let row = 0; row < ROWS; row++) {
    const radius = 14 + row * 1.25;
    for (let i = 0; i < PER_ROW; i++) {
      // Leaves an aisle in the middle.
      const slot = i < PER_ROW / 2 ? i : i + 1.5;
      const angle = ((slot - (PER_ROW + 1.5) / 2) * 1.08) / radius;
      seats.push({
        id: `${String.fromCharCode(65 + row)}${i + 1}`,
        taken: random() < 0.35,
        position: [Math.sin(angle) * radius, row * 0.38, -12 + Math.cos(angle) * radius],
        rotation: [0, angle, 0],
      });
    }
  }
  return seats;
};

export default function Cinema() {
  const insets = useSafeAreaInsets();
  const seats = useMemo(layout, []);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(
    () =>
      seats.map((s) => ({
        ...s,
        color: s.taken ? "#5b6068" : picked.has(s.id) ? "#22c55e" : "#c2410c",
      })),
    [seats, picked],
  );
  const toggle = (s: Seat) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(s.id)) next.delete(s.id);
      else next.add(s.id);
      return next;
    });

  return (
    <View style={styles.screen}>
      {/* The seats cast shadows on the steps. */}
      <Scene
        loading={<SceneLoading />}
        style={StyleSheet.absoluteFill}
        look="soft"
        background="#14161b"
        camera={{ fov: 45 }}
        shadows
        debug
      >
        {/* The screen. */}
        <Plane size={[22, 9]} position={[0, 6, -14]} material={{ preset: "light", color: "#dfe7ff" }} />
        <Plane size={60} rotation={[-Math.PI / 2, 0, 0]} color="#24272e" material="matte" />
        {/* Each seat is an instance of a cushion and a back. */}
        <Instances items={items} material="plastic" onPress={({ item }) => !item.taken && toggle(item)}>
          <Box size={[0.9, 0.25, 0.85]} position={[0, 0.45, 0]} />
          <Box size={[0.9, 0.9, 0.18]} position={[0, 0.85, 0.42]} />
        </Instances>
        <CameraRig
          subject={null}
          view={{ azimuth: 0, elevation: 32, distance: 36, target: [0, 2, 2] }}
          orbit={{ turn: 55, elevation: [8, 70], zoom: [0.45, 1.3] }}
          inset={{ bottom: 120 + insets.bottom }}
        />
      </Scene>
      <View style={[styles.card, { paddingBottom: 16 + insets.bottom }]}>
        <Text style={styles.title}>
          {picked.size === 0
            ? "Tap seats to pick them"
            : `${picked.size} seat${picked.size > 1 ? "s" : ""}: ${[...picked].join(", ")}`}
        </Text>
        <Text style={styles.sub}>
          {seats.length} seats, drawn as copies of one seat · drag to look round, pinch to zoom
        </Text>
        {picked.size > 0 ? (
          <Pressable style={styles.button} onPress={() => setPicked(new Set())}>
            <Text style={styles.buttonText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#14161b" },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 0,
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  title: { color: "#111827", fontWeight: "600", fontSize: 16 },
  sub: { color: "#6b7280", fontSize: 12, marginTop: 4 },
  button: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#eef1f4",
  },
  buttonText: { color: "#111827", fontWeight: "600", fontSize: 13 },
});
