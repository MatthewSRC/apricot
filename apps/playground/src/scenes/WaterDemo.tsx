import {
  Bundle,
  CameraRig,
  Daylight,
  type Place,
  Placeable,
  Placement,
  type PlacementArea,
  type PlacementHandle,
  type PlacementZone,
  Scene,
  type SceneObject,
  useLayout,
  useShore,
  useWaves,
  Water,
} from "@apricotjs/react-native";
import { memo, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../ui/Chip";
import { SceneLoading } from "../ui/SceneLoading";
import { BOUNDS, DECK, DRY_SAND, Ground, isLand, ROCKS, rect, SAND, SEA, TILE } from "./water/ground";
import { type Kind, PIECES, type Piece, SNAPS, START } from "./water/pieces";

// A sandbank in the sea to set up. Loungers snap to the deck, floating pieces stay in the water and ride
// the waves, and the boat moors at its spot.

const COLORS = { background: "#e2eef7", text: "#2c4d68", strong: "#1f9fd0" };

const TIMES = [
  { label: "Morning", hour: 9 },
  { label: "Noon", hour: 12.5 },
  { label: "Afternoon", hour: 15.5 },
  { label: "Sunset", hour: 18.4 },
];

const ZONES: PlacementZone[] = [
  {
    id: "rocks",
    outline: rect({
      minX: ROCKS.x - ROCKS.radius,
      maxX: ROCKS.x + ROCKS.radius,
      minZ: ROCKS.z - ROCKS.radius,
      maxZ: ROCKS.z + ROCKS.radius,
    }),
  },
];

const floats = (kind: Kind) => PIECES[kind].on === "water";

const startPlace = (kind: Kind): Place =>
  floats(kind) ? { position: [-2.2, SEA, 1.6], turn: 0 } : { position: [0.6, SAND, -0.4], turn: 0 };

export default function WaterDemo() {
  const insets = useSafeAreaInsets();
  const layout = useLayout(START, { save: "water", version: 1 });
  const pieces = layout.items;
  const [selected, setSelected] = useState<string | null>(null);
  // Clears the selection when undo removes the selected piece.
  if (selected !== null && !pieces.some((p) => p.id === selected)) setSelected(null);
  const [fits, setFits] = useState(true);
  const [time, setTime] = useState(2);
  const [tile, setTile] = useState<SceneObject | null>(null);
  const placement = useRef<PlacementHandle>(null);
  const sea = useWaves({ height: 0.012, length: 1.1, speed: 0.5, direction: 20 });
  const shore = useShore(isLand, BOUNDS, { reach: 2.2, size: 160 });
  // Later areas lie on top of earlier ones: the sand on the sea, and the deck on the sand.
  const areas = useMemo<PlacementArea[]>(
    () => [
      {
        id: "sea",
        outline: rect({ minX: BOUNDS[0], minZ: BOUNDS[1], maxX: BOUNDS[2], maxZ: BOUNDS[3] }),
        water: sea,
      },
      { id: "sand", outline: DRY_SAND, level: SAND },
      { id: "deck", outline: rect(DECK), level: DECK.top },
    ],
    [sea],
  );
  const picked = pieces.find((p) => p.id === selected) ?? null;
  const add = (kind: Kind) => {
    const id = layout.newId(kind);
    layout.add({ id, kind, ...startPlace(kind) });
    setSelected(id);
  };

  return (
    <View style={styles.screen}>
      <Scene
        loading={<SceneLoading />}
        style={StyleSheet.absoluteFill}
        look="none"
        toneMapping="neutral"
        background="#d5ecf3"
        shadows={{ size: 2048, softness: 3, darkness: 0.85 }}
        debug
      >
        <Daylight time={TIMES[time].hour} north={1.2} background={false} transition={1.5} />
        <Bundle>
          <Ground onTile={setTile} />
          <Water
            size={[TILE.width, TILE.depth]}
            spacing={0.12}
            waves={sea}
            shore={shore}
            shallow="#3fe3d4"
            deep="#14a0ea"
            shoreline="#c8f5ea"
            clarity={0.3}
            sparkle={0.2}
          />
          <Placement
            ref={placement}
            areas={areas}
            zones={ZONES}
            snaps={SNAPS}
            snap={{ turn: 15 }}
            collide="warn"
            // The boat stays in the sea.
            canPlace={(id, _place, { area }) => !id.startsWith("boat") || area === "sea"}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setFits(true);
            }}
            onChange={layout.place}
            onFitChange={(_, now) => setFits(now)}
            marker={{ color: "#3ccf6e", blocked: "#ff5a4f", radius: 0.12 }}
          >
            {layout.loaded && pieces.map((p) => <PieceView key={p.id} piece={p} />)}
          </Placement>
        </Bundle>
        <CameraRig
          subject={tile}
          margin={0.06}
          view={{ azimuth: -36, elevation: 34, fov: 30 }}
          orbit={{ turn: 60, elevation: [12, 70], zoom: [0.5, 1.4] }}
          inset={{ bottom: 150 + insets.bottom }}
        />
      </Scene>
      <View style={[styles.panel, { paddingBottom: 14 + insets.bottom }]}>
        {picked ? (
          <>
            <Text style={styles.title}>{PIECES[picked.kind].name}</Text>
            <Text style={[styles.sub, !fits && styles.warn]}>
              {fits
                ? floats(picked.kind)
                  ? "Drag it on the water · twist to turn"
                  : "Drag it on the sand or the deck · twist to turn"
                : "Doesn't fit here: let go and it goes back"}
            </Text>
            <View style={styles.row}>
              <Chip colors={COLORS} label="⟲ 45°" onPress={() => placement.current?.turnBy(picked.id, 45)} />
              <Chip colors={COLORS} label="⟳ 45°" onPress={() => placement.current?.turnBy(picked.id, -45)} />
              <Chip
                colors={COLORS}
                label="Remove"
                onPress={() => {
                  layout.remove(picked.id);
                  setSelected(null);
                }}
              />
              <Chip colors={COLORS} label="↶" disabled={!layout.canUndo} onPress={layout.undo} />
              <Chip colors={COLORS} label="Done" strong onPress={() => setSelected(null)} />
            </View>
          </>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.times}
            >
              {TIMES.map((t, i) => (
                <Chip
                  key={t.label}
                  colors={COLORS}
                  label={t.label}
                  strong={i === time}
                  onPress={() => setTime(i)}
                />
              ))}
            </ScrollView>
            <Text style={styles.title}>Tap something to pick it up</Text>
            <Text style={styles.sub}>
              Loungers snap to the deck · the boat moors at its spot · rocks keep clear
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Chip colors={COLORS} label="↶ Undo" disabled={!layout.canUndo} onPress={layout.undo} />
              <Chip colors={COLORS} label="↷ Redo" disabled={!layout.canRedo} onPress={layout.redo} />
              {(Object.keys(PIECES) as Kind[]).map((kind) => (
                <Chip key={kind} colors={COLORS} label={`+ ${PIECES[kind].name}`} onPress={() => add(kind)} />
              ))}
              <Chip colors={COLORS} label="Reset" onPress={() => layout.set(START)} />
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

// Memoised so a piece re-renders only when it moves.
const PieceView = memo(function PieceView({ piece: p }: { piece: Piece }) {
  const spec = PIECES[p.kind];
  return (
    <Placeable
      id={p.id}
      position={p.position}
      turn={p.turn}
      on={spec.on}
      solid={spec.solid}
      surface={spec.surface}
    >
      {spec.make()}
    </Placeable>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#d5ecf3" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(250,253,255,0.94)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 4,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#1f3b52" },
  sub: { fontSize: 13, color: "#56708a" },
  warn: { color: "#d2453a" },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  times: { flexDirection: "row", gap: 8, marginBottom: 8 },
});
