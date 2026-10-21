import {
  Box,
  BURSTS,
  type BurstName,
  CameraRig,
  Cone,
  Cylinder,
  EMITTERS,
  type EmitterName,
  Group,
  Particles,
  type ParticlesHandle,
  Scene,
  type SceneObject,
} from "@apricotjs/react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SceneLoading } from "../ui/SceneLoading";

// Emitter positions: the fountain spout, the chimney, the sparkler tip and above the square.
const FOUNTAIN: [number, number, number] = [-1.3, 0.62, 0.5];
const CHIMNEY: [number, number, number] = [1.75, 1.6, -0.85];
const SPARKLER: [number, number, number] = [0.25, 0.64, 1.35];
const STREAMS: Record<EmitterName, { label: string; at: [number, number, number] }> = {
  fountain: { label: "Fountain", at: FOUNTAIN },
  smoke: { label: "Smoke", at: CHIMNEY },
  sparkler: { label: "Sparkler", at: SPARKLER },
  snow: { label: "Snow", at: [0, 3.5, 0] },
};
const BURST_LABELS: Record<BurstName, string> = {
  sparkle: "Sparkle",
  pop: "Pop",
  confetti: "Confetti",
  firework: "Firework",
};

/** A small square with a fountain, a cottage with a chimney and a sparkler in the ground. */
function Square({ onRef }: { onRef: (o: SceneObject | null) => void }) {
  return (
    <Group ref={onRef}>
      <Cylinder radius={2.7} height={0.1} position={[0, -0.05, 0]} color="#d9cbb8" segments={64} />
      {/* The fountain. */}
      <Cylinder radius={0.62} height={0.32} position={[-1.3, 0.16, 0.5]} color="#c9c3bb" />
      <Cylinder radius={0.54} height={0.02} position={[-1.3, 0.31, 0.5]} color="#7cc3e8" />
      <Cylinder radius={0.05} height={0.32} position={[-1.3, 0.46, 0.5]} color="#b5aea5" />
      {/* The cottage. */}
      <Box size={[1.3, 0.9, 1.1]} position={[1.4, 0.45, -0.6]} color="#f3e4cf" />
      <Cone
        radius={1.05}
        height={0.7}
        segments={4}
        position={[1.4, 1.25, -0.6]}
        rotation={[0, Math.PI / 4, 0]}
        color="#c8664f"
      />
      <Box size={[0.22, 0.6, 0.22]} position={[1.75, 1.3, -0.85]} color="#9c8a7a" />
      <Box size={[0.3, 0.5, 0.04]} position={[1.4, 0.25, -0.03]} color="#7a5641" />
      {/* The sparkler. */}
      <Cylinder radius={0.012} height={0.64} position={[0.25, 0.32, 1.35]} color="#6f6a66" />
    </Group>
  );
}

export default function ParticlesDemo() {
  const insets = useSafeAreaInsets();
  const sparks = useRef<ParticlesHandle>(null);
  const [square, setSquare] = useState<SceneObject | null>(null);
  const [night, setNight] = useState(false);
  const [on, setOn] = useState<Record<EmitterName, boolean>>({
    fountain: true,
    smoke: true,
    sparkler: false,
    snow: false,
  });
  const fire = (name: BurstName) =>
    sparks.current?.burst(name, { at: name === "firework" ? [0, 3, 0] : [0, 1, 0] });

  return (
    <View style={[styles.screen, night && styles.night]}>
      <Scene
        loading={<SceneLoading />}
        style={StyleSheet.absoluteFill}
        background={night ? "#141a2b" : "#e9eef2"}
        debug
      >
        <Square onRef={setSquare} />
        {/* Bursts fired by the buttons. They glow at night. */}
        <Particles ref={sparks} max={600} glow={night} />
        {/* One emitter per stream, active while switched on. */}
        {(Object.keys(STREAMS) as EmitterName[]).map((name) => (
          <Particles
            key={name}
            max={name === "snow" ? 400 : 200}
            glow={night && name === "sparkler"}
            emit={on[name] && { ...EMITTERS[name], at: STREAMS[name].at }}
          />
        ))}
        <CameraRig
          subject={square}
          margin={0}
          view={{ azimuth: -30, elevation: 26, fov: 30 }}
          orbit={{ turn: 180, elevation: [10, 70], zoom: [0.5, 1.4] }}
          inset={{ bottom: 170 + insets.bottom }}
        />
      </Scene>
      <View style={[styles.panel, { paddingBottom: 14 + insets.bottom }]}>
        <Text style={styles.title}>Particles</Text>
        <Text style={styles.sub}>Bursts by code, streams while switched on · drag to look round</Text>
        <View style={styles.row}>
          {(Object.keys(BURSTS) as BurstName[]).map((name) => (
            <Pressable key={name} style={[styles.button, styles.strong]} onPress={() => fire(name)}>
              <Text style={[styles.buttonText, styles.strongText]}>{BURST_LABELS[name]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          {(Object.keys(STREAMS) as EmitterName[]).map((name) => (
            <Pressable
              key={name}
              style={[styles.button, on[name] && styles.picked]}
              onPress={() => setOn((now) => ({ ...now, [name]: !now[name] }))}
            >
              <Text style={styles.buttonText}>{STREAMS[name].label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.button, night && styles.picked]} onPress={() => setNight((n) => !n)}>
            <Text style={styles.buttonText}>Night</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#e9eef2" },
  night: { backgroundColor: "#141a2b" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(250,251,253,0.94)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 4,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#24303f" },
  sub: { fontSize: 13, color: "#5d6b7a" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#e6ebf0" },
  buttonText: { fontSize: 14, fontWeight: "600", color: "#33475b" },
  strong: { backgroundColor: "#ff8a5c" },
  strongText: { color: "#ffffff" },
  picked: { backgroundColor: "#bfe3d0" },
});
