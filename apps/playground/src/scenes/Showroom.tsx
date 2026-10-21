import { StudioFloor } from "@apricotjs/assets";
import {
  CameraRig,
  type CameraRigHandle,
  Environment,
  type MaterialInput,
  Scene,
} from "@apricotjs/react-native";
import { Model, type ModelKit, type PartPressEvent } from "@apricotjs/react-native/model";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SHOWROOM_MODELS, type ShowroomModel } from "../showroom/models";
import { SceneLoading } from "../ui/SceneLoading";

const COLORS = ["#a8102a", "#1c4f9c", "#e9eaec", "#111214", "#9da3ab", "#e3a21a", "#2f6b3a"];
const VIEWS = [
  ["three-quarter", "3/4"],
  ["front", "Front"],
  ["left", "Side"],
  ["back", "Back"],
  ["top", "Top"],
] as const;
const ENVIRONMENTS = ["studio", "soft", "sunset", "night"] as const;

/** The kit parts that are joints, which open when tapped. */
const jointsOf = (kit: ModelKit) =>
  Object.entries(kit.parts)
    .filter(([, part]) => typeof part === "object" && !Array.isArray(part))
    .map(([key]) => key);

/** The model's materials with the paint part recoloured. */
const paintedMaterials = (model: ShowroomModel, color: string | null) => {
  const paint = model.paint;
  if (!paint || !color) return model.materials;
  const current: MaterialInput = model.materials[paint] ?? "car-paint";
  if (typeof current === "object" && "isMaterial" in current) return model.materials;
  const base = typeof current === "string" ? { preset: current } : current;
  return { ...model.materials, [paint]: { ...base, color, transition: 0.6 } };
};

// A model kit with preset materials, paint colours, parts that open when tapped, named camera views,
// environments and a part inspector. Local models can be added as described in assets/local/README.md.
export default function Showroom() {
  const insets = useSafeAreaInsets();
  const [modelId, setModelId] = useState(SHOWROOM_MODELS[0].id);
  const model = SHOWROOM_MODELS.find((m) => m.id === modelId) ?? SHOWROOM_MODELS[0];
  const [color, setColor] = useState<string | null>(null);
  const [view, setView] = useState("three-quarter");
  const rig = useRef<CameraRigHandle>(null);
  // Choosing the current view again flies back to it after the camera was moved by hand.
  const chooseView = (next: string) => (next === view ? rig.current?.flyTo(next) : setView(next));
  const [environment, setEnvironment] = useState<string>("studio");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [inspect, setInspect] = useState(false);
  const [panel, setPanel] = useState(0);
  // Dragging sideways turns the environment lights through a shared value, without re-rendering.
  const lights = useSharedValue(0);
  const start = useSharedValue(0);
  const turn = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onBegin(() => {
      start.value = lights.value;
    })
    .onUpdate((e) => {
      lights.value = start.value + e.translationX / 120;
    });

  const joints = useMemo(() => jointsOf(model.kit), [model]);
  const materials = useMemo(() => paintedMaterials(model, color), [model, color]);
  const jointValues = Object.fromEntries(joints.map((key) => [key, open[key] ? 1 : 0]));

  const choose = (id: string) => {
    setModelId(id);
    setOpen({});
    setColor(null);
  };
  const onPartPress = ({ part }: PartPressEvent) => {
    if (inspect || !part || !joints.includes(part)) return;
    setOpen((current) => ({ ...current, [part]: !current[part] }));
  };

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={turn}>
        <View style={StyleSheet.absoluteFill}>
          <Scene
            loading={<SceneLoading />}
            style={StyleSheet.absoluteFill}
            look="none"
            background="#0e0f12"
            camera={{ fov: 32 }}
            debug
          >
            <Environment name={environment} rotation={lights} />
            <StudioFloor radius={8} />
            {/* `ground` puts the model on the floor wherever its origin is. */}
            <Model
              key={model.id}
              ground
              kit={model.kit}
              materials={materials}
              joints={jointValues}
              inspect={inspect}
              onPartPress={onPartPress}
            >
              {/* Drag to orbit and pinch to zoom. */}
              <CameraRig
                ref={rig}
                view={view}
                inset={{ bottom: panel }}
                orbit={{ elevation: [2, 70], zoom: [0.6, 1.8] }}
              />
            </Model>
          </Scene>
        </View>
      </GestureDetector>
      <View
        style={[styles.panel, { paddingBottom: 12 + insets.bottom }]}
        onLayout={(e) => setPanel(e.nativeEvent.layout.height)}
      >
        <Text style={styles.hint}>
          {inspect
            ? "Inspect: tap a part to see its name and material"
            : joints.length
              ? "Tap a door, the hood or the trunk · drag sideways to turn the lights"
              : "Drag sideways to turn the lights · no parts open: add hinges in its kit"}
        </Text>
        {SHOWROOM_MODELS.length > 1 ? (
          <Chips
            items={SHOWROOM_MODELS.map((m) => [m.id, m.title] as const)}
            selected={model.id}
            onSelect={choose}
          />
        ) : null}
        {model.paint ? (
          <View style={styles.row}>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                accessibilityLabel={`Colour ${c}`}
                style={[styles.swatch, { backgroundColor: c }, c === color && styles.swatchActive]}
              />
            ))}
          </View>
        ) : null}
        <Chips items={VIEWS} selected={view} onSelect={chooseView} />
        <Chips
          items={[
            ...ENVIRONMENTS.map((e) => [e, e] as const),
            ["inspect", inspect ? "Inspect ✓" : "Inspect"],
          ]}
          selected={environment}
          onSelect={(id) => (id === "inspect" ? setInspect((v) => !v) : setEnvironment(id))}
        />
        {model.credit ? <Text style={styles.credit}>{model.credit}</Text> : null}
      </View>
    </View>
  );
}

function Chips({
  items,
  selected,
  onSelect,
}: {
  items: readonly (readonly [string, string])[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map(([id, label]) => (
        <Pressable
          key={id}
          onPress={() => onSelect(id)}
          style={[styles.chip, id === selected && styles.chipActive]}
        >
          <Text style={[styles.chipText, id === selected && styles.chipTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0e0f12" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    gap: 10,
    backgroundColor: "rgba(14,15,18,0.86)",
  },
  hint: { color: "#8b9099", textAlign: "center", fontSize: 13 },
  credit: { color: "#5d636c", textAlign: "center", fontSize: 11 },
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 16, justifyContent: "center" },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "#2a2d33" },
  swatchActive: { borderColor: "#f1f3f5" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "#1c1e23" },
  chipActive: { backgroundColor: "#f1f3f5" },
  chipText: { color: "#c9cdd3", fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#111214" },
});
