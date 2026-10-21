import { Trees } from "@apricotjs/assets";
import {
  Box,
  CameraRig,
  type CameraRigHandle,
  Cylinder,
  Daylight,
  FollowPath,
  Group,
  Instances,
  Label,
  Mesh,
  Plane,
  Scene,
  type SceneObject,
  type TripHandle,
  usePath,
  useTrip,
  useTripStatus,
} from "@apricotjs/react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createBuildings, createDeck, createRails, DECK } from "../metro/world";
import { SceneLoading } from "../ui/SceneLoading";

// A train running back and forth on a curved viaduct and stopping at each station, followed by the
// camera. A label rides above the train, and the time of day changes the light.

const LINE: [number, number, number][] = [
  [-520, 0, 260],
  [-300, 0, 160],
  [-120, 0, 180],
  [60, 0, 60],
  [140, 0, -140],
  [320, 0, -260],
  [540, 0, -220],
];
const STATIONS = ["Bến Thành", "Ba Son", "Tân Cảng", "Thảo Điền"];
const CAR_LENGTH = 20;
const CARS = [-1, 0, 1].map((i) => i * (CAR_LENGTH + 1));
const TIMES = [9, 13, 18.6, 21.5];
/** Formats an hour as a clock time, for example 18.6 as "18:36". */
const clock = (hour: number) => `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

const timeOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Car() {
  return (
    <Group position={[0, DECK + 2, 0]}>
      <Box size={[3, 3.4, CAR_LENGTH]} radius={0.5} material={{ preset: "paint", color: "#f3f5f7" }} />
      <Box size={[3.06, 0.35, CAR_LENGTH - 0.6]} position={[0, -0.9, 0]} color="#1f8a4c" />
      <Box size={[3.08, 0.12, CAR_LENGTH - 0.6]} position={[0, -1.25, 0]} color="#c62f3a" />
      <Box size={[3.1, 1.1, CAR_LENGTH - 2]} position={[0, 0.45, 0]} material={{ preset: "gloss-black" }} />
    </Group>
  );
}

// The countdown updates every second. It lives in small components so those re-renders don't reach the scene.
function TrainPill({ trip }: { trip: TripHandle }) {
  const status = useTripStatus(trip);
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>Your train · {status.stopped ? "boarding" : timeOf(status.seconds)}</Text>
    </View>
  );
}

function TripStatusText({ trip }: { trip: TripHandle }) {
  const status = useTripStatus(trip);
  const headline = status.stopped
    ? `At ${STATIONS[status.stop]} · leaves in ${timeOf(status.seconds)}`
    : `Departed · next: ${STATIONS[status.nextStop]}`;
  return (
    <>
      <Text style={styles.kicker}>{status.stopped ? "YOUR TRAIN · BOARDING" : "YOUR TRAIN · DEPARTED"}</Text>
      <Text style={styles.title}>{headline}</Text>
      <Text style={styles.sub}>{status.stopped ? "" : `arrives in ${timeOf(status.seconds)}`}</Text>
    </>
  );
}

export default function MetroLine() {
  const insets = useSafeAreaInsets();
  const line = usePath(LINE);
  const stops = useMemo(
    () => STATIONS.map((_, i) => 40 + (i / (STATIONS.length - 1)) * (line.length - 80)),
    [line],
  );
  const trip = useTrip({ path: line, stops, speed: 24, acceleration: 1.1, dwell: 10 });
  const lead = useRef<SceneObject>(null);
  const rig = useRef<CameraRigHandle>(null);
  const [mode, setMode] = useState<"follow" | "map">("follow");
  const [time, setTime] = useState(0);

  const world = useMemo(
    () => ({
      deck: createDeck(line),
      rails: createRails(line),
      buildings: createBuildings(line, [-700, -500, 700, 500], 140),
      pillars: line.every(36, 10).map((d) => {
        const p = line.pointAt(d);
        return { position: [p.x, (DECK - 1) / 2, p.z] as const };
      }),
      platforms: stops.map((d) => {
        const at = line.pointAt(d);
        const angle = Math.atan2(line.tangentAt(d).x, line.tangentAt(d).z);
        return {
          at,
          angle,
          floor: { position: [at.x, DECK + 0.5, at.z] as const, rotation: [0, angle, 0] as const },
          roof: { position: [at.x, DECK + 7.5, at.z] as const, rotation: [0, angle, 0] as const },
        };
      }),
    }),
    [line, stops],
  );
  // The buildings and rails carry their own colours.
  const painted = { preset: "matte", color: "#ffffff", roughness: 0.8, vertexColors: true } as const;

  return (
    <View style={styles.screen}>
      <Scene
        loading={<SceneLoading />}
        style={StyleSheet.absoluteFill}
        look="none"
        environment="soft"
        fog={{ near: 600, far: 2400 }}
        camera={{ fov: 40 }}
        // Sun shadows cover 120 m around the camera target.
        shadows={{ radius: 120 }}
        debug
      >
        <Daylight time={TIMES[time]} />
        <Plane size={2400} rotation={[-Math.PI / 2, 0, 0]} color="#dfe6d3" material={{ preset: "matte" }} />
        <Plane
          size={[2400, 160]}
          rotation={[-Math.PI / 2, 0, -0.5]}
          position={[0, 0.3, 40]}
          material={{ preset: "paint", color: "#7fb0c6", roughness: 0.15 }}
        />
        <Mesh geometry={world.buildings} material={painted} />
        <Trees count={260} area={[-650, -450, 650, 450]} clearing={0} scale={[3.5, 6]} seed={4} />
        <Mesh geometry={world.deck} material={{ preset: "matte", color: "#b9bcc2", side: "double" }} />
        <Mesh geometry={world.rails} material={painted} />
        {/* Repeated parts are instanced, one draw call each. */}
        <Instances items={world.pillars} material={{ preset: "matte", color: "#a7abb2" }}>
          <Cylinder radius={1.2} height={DECK - 1} segments={24} />
        </Instances>
        <Instances items={world.platforms.map((p) => p.floor)} color="#e9e4da">
          <Box size={[16, 1, 70]} />
        </Instances>
        <Instances items={world.platforms.map((p) => p.roof)} color="#2f7d55">
          <Box size={[18, 0.6, 72]} />
        </Instances>
        {world.platforms.map(({ at, angle }, i) => (
          <Group key={STATIONS[i]} position={[at.x, 0, at.z]} rotation={[0, angle, 0]}>
            <Label position={[0, DECK + 10, 0]}>
              <Text style={styles.station}>{STATIONS[i]}</Text>
            </Label>
          </Group>
        ))}
        {CARS.map((offset) => (
          <FollowPath
            key={offset}
            path={line}
            trip={trip}
            offset={offset}
            ref={offset === 0 ? lead : undefined}
          >
            <Car />
          </FollowPath>
        ))}
        <Label attach={lead} position={[0, DECK + 7, 0]}>
          <TrainPill trip={trip} />
        </Label>
        <CameraRig
          ref={rig}
          follow={mode === "follow" ? lead : null}
          view={
            mode === "follow"
              ? { azimuth: 55, elevation: 26, distance: 210 }
              : { azimuth: 0, elevation: 90, distance: 1250, target: [0, 0, 0] }
          }
          drift={mode === "follow" ? 2 : 0}
          // Drag to look around. The camera returns to its view after 5 seconds.
          orbit={{ elevation: [8, 89], zoom: [0.4, 2], returnAfter: 5 }}
          transition={1.6}
          inset={{ bottom: 150 + insets.bottom }}
        />
      </Scene>
      <View style={[styles.card, { paddingBottom: 16 + insets.bottom }]}>
        <TripStatusText trip={trip} />
        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={() => setTime((t) => (t + 1) % TIMES.length)}>
            <Text style={styles.buttonText}>☀︎ {clock(TIMES[time])}</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => setMode((m) => (m === "follow" ? "map" : "follow"))}
          >
            <Text style={styles.buttonText}>{mode === "follow" ? "Map" : "Follow train"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#cfe2f2" },
  station: {
    color: "#1d2a22",
    fontWeight: "700",
    fontSize: 12,
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  pill: { backgroundColor: "#1f9d55", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  pillText: { color: "#ffffff", fontWeight: "700", fontSize: 13 },
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 0,
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  kicker: { color: "#1f9d55", fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  title: { color: "#111827", fontWeight: "600", fontSize: 17, marginTop: 4 },
  sub: { color: "#6b7280", fontSize: 13, marginTop: 2, minHeight: 16 },
  buttons: { flexDirection: "row", gap: 8, marginTop: 10 },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "#eef1f4" },
  buttonText: { color: "#111827", fontWeight: "600", fontSize: 13 },
});
