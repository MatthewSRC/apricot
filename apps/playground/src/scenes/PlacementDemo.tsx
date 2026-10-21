import type { ApricotScene } from "@apricotjs/core";
import {
  Bundle,
  CameraRig,
  type Collide,
  Daylight,
  type DaylightKey,
  DirectionalLight,
  Group,
  LightBeam,
  Particles,
  type ParticlesHandle,
  type Place,
  Placeable,
  Placement,
  type PlacementHandle,
  Scene,
  type SceneObject,
  useLayout,
} from "@apricotjs/react-native";
import { type Capture, captureScene } from "@apricotjs/react-native/capture";
import { memo, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../ui/Chip";
import { SceneLoading } from "../ui/SceneLoading";
import { type Kind, PIECES, type Piece, type PieceSpec, START } from "./placement/pieces";
import { BACK, BOUNDS, ROOM, Room, WINDOW_MIDDLE } from "./placement/room";

// A room to furnish: pieces are picked up, dragged and turned; small things stand on tables, shelves and
// the floor, and frames hang on the walls. The time of day moves the sun through the window.

const COLORS = { background: "#f1e3da", text: "#5b4036", strong: "#e98a6a" };

const TIMES = [
  { label: "Morning", hour: 8.5, front: 0.8 },
  { label: "Noon", hour: 12.5, front: 0.9 },
  { label: "Afternoon", hour: 16.5, front: 0.9 },
  { label: "Sunset", hour: 18.6, front: 0.6 },
  { label: "Night", hour: 22, front: 0.12 },
];

// The window faces west, so the afternoon sun comes in through it low and warm.
const NORTH = Math.PI + 0.9;

const key = (
  hour: number,
  sun: string,
  sunIntensity: number,
  sky: string,
  ground: string,
  fillIntensity: number,
  background: string,
): DaylightKey => ({ hour, sun, sunIntensity, sky, ground, fillIntensity, background, reflections: 1 });

/** Indoor daylight, warmer than the outdoor defaults. */
const ROOM_DAY: DaylightKey[] = [
  key(0, "#8796cc", 0.9, "#4a4f74", "#24222f", 1.3, "#33324a"),
  key(5.5, "#93a0d0", 0.9, "#5a5d80", "#2e2b38", 1.4, "#3e3c54"),
  key(7, "#ffcfa4", 4, "#f6e9e2", "#dcbca4", 2.3, "#e8d8d2"),
  key(12.5, "#fff3e4", 7, "#fff6ee", "#e8caae", 2.7, "#e3d5cf"),
  key(16.5, "#ffb06a", 8, "#fff3e6", "#e8bf98", 2.73, "#dccbc4"),
  key(18.6, "#ff8448", 6.5, "#f3c6ad", "#c9967c", 2.1, "#d8aea4"),
  key(19.6, "#8d98cc", 1, "#5d5c82", "#2e2a3a", 1.5, "#46425c"),
];

const COLLIDE: { mode: Collide; label: string }[] = [
  { mode: "warn", label: "Pass through, red where it doesn't fit" },
  { mode: "block", label: "Stop against things" },
  { mode: "off", label: "Overlap freely" },
];

const HINT: Record<string, string> = {
  floor: "Drag to move · twist two fingers to turn · tap the floor to put it down",
  surface: "Drag onto a table, a shelf or the floor · twist to turn",
  wall: "Drag along the walls · tap the floor to put it down",
};

/** Where a new piece starts: on the back wall, or in the middle of the room. */
const startPlace = (kind: Kind): Place =>
  PIECES[kind].on === "wall"
    ? { position: [0.2, 1.3, -ROOM.depth / 2], turn: BACK }
    : { position: [0.3, 0, 0.5], turn: 0 };

export default function PlacementDemo() {
  const insets = useSafeAreaInsets();
  // Saved between runs; bump the version when START changes.
  const layout = useLayout(START, { save: "placement", version: 1 });
  const pieces = layout.items;
  const [selected, setSelected] = useState<string | null>(null);
  // Clears the selection when undo removes the selected piece.
  if (selected !== null && !pieces.some((p) => p.id === selected)) setSelected(null);
  const placement = useRef<PlacementHandle>(null);
  const [room, setRoom] = useState<SceneObject | null>(null);
  const [collide, setCollide] = useState(0);
  const [fits, setFits] = useState(true);
  const [time, setTime] = useState(2);
  // The front fill light follows the time of day as <Daylight> does.
  const front = useSharedValue(TIMES[time].front);
  useEffect(() => {
    front.value = withTiming(TIMES[time].front, { duration: 1500 });
  }, [front, time]);

  const [scene, setScene] = useState<ApricotScene | null>(null);
  const [shot, setShot] = useState<(Capture & { ms: number }) | null>(null);
  const snapshot = async () => {
    if (!scene) return;
    const start = performance.now();
    const picture = await captureScene(scene, { maxSize: 1080 });
    setShot({ ...picture, ms: Math.round(performance.now() - start) });
  };

  // New pieces start at startPlace() and find room nearby on their own, then sparkle where they land.
  const sparks = useRef<ParticlesHandle>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const add = (kind: Kind) => {
    const id = layout.newId(kind);
    layout.add({ id, kind, ...startPlace(kind) });
    setFresh((now) => new Set(now).add(id));
    setSelected(id);
  };
  const arrived = (id: string, place: Place | null) => {
    setFresh((now) => {
      const next = new Set(now);
      next.delete(id);
      return next;
    });
    if (!place) return;
    const [x, y, z] = place.position;
    sparks.current?.burst("sparkle", { at: [x, y + 0.4, z] });
  };

  const picked = pieces.find((p) => p.id === selected) ?? null;
  const spec: PieceSpec | null = picked ? PIECES[picked.kind] : null;
  const remove = () => {
    if (!picked) return;
    // Pieces standing on it go too.
    layout.remove([picked.id, ...(placement.current?.standingOn(picked.id) ?? [])]);
    setSelected(null);
  };

  return (
    <View style={styles.screen}>
      <Scene
        loading={<SceneLoading />}
        style={StyleSheet.absoluteFill}
        look="none"
        toneMapping="neutral"
        background="#dccbc4"
        shadows={{ size: 1024, softness: 3, darkness: 0.94 }}
        occlusion={{ radius: 0.5, strength: 1 }}
        lamps={2}
        debug
        onCreated={setScene}
      >
        <Daylight time={TIMES[time].hour} north={NORTH} keys={ROOM_DAY} transition={1.5} />
        <DirectionalLight position={[-5, 6, 6]} intensity={front} color="#fff4ea" castShadow={false} />
        {/* Recorded once and replayed each frame. */}
        <Bundle>
          <LightBeam
            sun
            from={WINDOW_MIDDLE}
            size={[ROOM.window.width, ROOM.window.height]}
            facing={[-1, 0, 0]}
            bounds={BOUNDS}
            intensity={5}
          />
          <Group ref={setRoom}>
            <Room />
          </Group>
          <Placement
            ref={placement}
            bounds={BOUNDS}
            wallHeight={ROOM.height}
            snap={{ grid: 0.05, turn: 15, wall: 0.12 }}
            collide={COLLIDE[collide].mode}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setFits(true);
            }}
            onChange={layout.place}
            onArrive={arrived}
            onFitChange={(_, now) => setFits(now)}
            marker={{ color: "#3ccf6e", blocked: "#ff5a4f", radius: 0.08 }}
          >
            {layout.loaded && pieces.map((p) => <PieceView key={p.id} piece={p} fresh={fresh.has(p.id)} />)}
          </Placement>
        </Bundle>
        {/* Outside the bundle, since particles move every frame. */}
        <Particles ref={sparks} max={300} />
        <CameraRig
          subject={room}
          margin={0.08}
          view={{ azimuth: -36, elevation: 32, fov: 30 }}
          orbit={{ turn: 40, elevation: [12, 70], zoom: [0.5, 1.4] }}
          inset={{ bottom: 150 + insets.bottom }}
        />
      </Scene>
      {shot ? (
        <Pressable style={[styles.shot, { top: 12 + insets.top }]} onPress={() => setShot(null)}>
          <Image
            source={{ uri: shot.uri }}
            style={{ width: 120, height: (120 * shot.height) / shot.width }}
          />
          <Text style={styles.shotText}>
            {shot.width}×{shot.height} · {shot.ms} ms
          </Text>
        </Pressable>
      ) : null}
      <View style={[styles.panel, { paddingBottom: 14 + insets.bottom }]}>
        {picked && spec ? (
          <>
            <Text style={styles.title}>{spec.name}</Text>
            <Text style={[styles.sub, !fits && styles.warn]}>
              {fits ? HINT[spec.on ?? "floor"] : "Doesn't fit here: let go and it goes back"}
            </Text>
            <View style={styles.row}>
              {spec.on !== "wall" ? (
                <>
                  <Chip
                    colors={COLORS}
                    label="⟲ 45°"
                    onPress={() => placement.current?.turnBy(picked.id, 45)}
                  />
                  <Chip
                    colors={COLORS}
                    label="⟳ 45°"
                    onPress={() => placement.current?.turnBy(picked.id, -45)}
                  />
                </>
              ) : null}
              <Chip colors={COLORS} label="Remove" onPress={remove} />
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
            <Text style={styles.title}>Tap a piece to pick it up</Text>
            <Text style={styles.sub}>
              Drag the room to look round · {pieces.length} pieces · layout {JSON.stringify(pieces).length}{" "}
              bytes
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Chip colors={COLORS} label="↶ Undo" disabled={!layout.canUndo} onPress={layout.undo} />
              <Chip colors={COLORS} label="↷ Redo" disabled={!layout.canRedo} onPress={layout.redo} />
              {(Object.keys(PIECES) as Kind[])
                .filter((kind) => !PIECES[kind].fixed)
                .map((kind) => (
                  <Chip
                    key={kind}
                    colors={COLORS}
                    label={`+ ${PIECES[kind].name}`}
                    onPress={() => add(kind)}
                  />
                ))}
              <Chip colors={COLORS} label="Reset" onPress={() => layout.set(START)} />
              <Chip colors={COLORS} label="Snapshot" disabled={!scene} onPress={snapshot} />
              <Chip
                colors={COLORS}
                label={COLLIDE[collide].label}
                onPress={() => setCollide((c) => (c + 1) % COLLIDE.length)}
              />
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

// Memoised so a piece re-renders only when it moves.
const PieceView = memo(function PieceView({ piece: p, fresh }: { piece: Piece; fresh: boolean }) {
  const spec: PieceSpec = PIECES[p.kind];
  return (
    <Placeable
      id={p.id}
      position={p.position}
      turn={p.turn}
      on={spec.on}
      surface={spec.surface}
      solid={spec.solid}
      locked={spec.locked}
      findRoom={fresh}
    >
      {spec.make()}
    </Placeable>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#dccbc4" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,250,246,0.94)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 4,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#3d2b24" },
  sub: { fontSize: 13, color: "#7a6259" },
  warn: { color: "#d2453a" },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  times: { flexDirection: "row", gap: 8, marginBottom: 8 },
  shot: {
    position: "absolute",
    right: 12,
    padding: 6,
    gap: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,250,246,0.94)",
  },
  shotText: { fontSize: 11, color: "#7a6259", textAlign: "center" },
});
