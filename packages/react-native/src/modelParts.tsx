// Joints, animation clips, shape keys, part taps and the part inspector for
// <Model>. Each driver is its own component, so drivers can be added and
// removed without breaking the rules of hooks.

import {
  ClipPlayer,
  Joint,
  type JointSpec,
  type PartSelector,
  type PressHit,
  selectParts,
  selectSlots,
  sourceMaterial,
} from "@apricotjs/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as THREE from "three/webgpu";
import { type Animatable, isShared, useAnimatable } from "./animatable";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { jointOf, type ModelKit, resolvePart } from "./kit";

/**
 * Drives a moving part from 0 (rest, closed) to 1 (open). A plain number
 * animates over `transition` seconds. A shared value is followed exactly, so
 * it can be driven by withSpring, a gesture or a sensor. The hinge is given
 * here or in the model kit.
 */
export type JointInput = Animatable<number> | InlineJoint;

/** A joint defined inline: its value, and optionally the parts and the hinge. */
export interface InlineJoint extends JointSpec {
  value: Animatable<number>;
  /** The parts to move. Default: the key, as a kit name or selector. */
  select?: PartSelector;
  /** Seconds a change of a plain value takes. Default: the kit joint's, or 0.6. */
  transition?: number;
}

/**
 * Drives an animation clip: a progress from 0 to 1, "once" to play it once,
 * or "loop" to repeat it. A plain progress animates; a shared value scrubs.
 */
export type ClipInput = Animatable<number> | "once" | "loop";

/** A tap on a model part. */
export interface PartPressEvent<P extends string = string> {
  /**
   * The kit name of the tapped part: a joint that includes it if there is
   * one, otherwise the most specific name. Undefined without a kit, or when
   * the kit does not name the part.
   */
  part: P | undefined;
  /** Every kit name whose selector includes the tapped mesh. */
  parts: P[];
  /** The tapped mesh's name. */
  name: string;
  /** The name of the tapped material in the file, as matched by `material:` selectors. */
  material: string;
  /** The name of the material that replaced it, such as a preset's name, or undefined. */
  wearing: string | undefined;
  mesh: THREE.Mesh;
  point: THREE.Vector3;
}

const isInlineJoint = (input: JointInput): input is InlineJoint =>
  typeof input === "object" && input !== null && "value" in input && !isShared(input);

/** Eases a value towards a target over a fixed time, with smoothstep easing. */
class Follower {
  current = 0;
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private duration = 0;

  constructor(initial: number) {
    this.current = initial;
    this.to = initial;
  }

  target(value: number, seconds: number) {
    if (value === this.to) return;
    this.from = this.current;
    this.to = value;
    this.elapsed = 0;
    this.duration = seconds;
    if (seconds <= 0) this.current = value;
  }

  /** Advances by `delta` seconds. Returns true while still moving. */
  step(delta: number) {
    if (this.current === this.to) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + delta);
    const t = this.elapsed / this.duration;
    this.current = t >= 1 ? this.to : this.from + (this.to - this.from) * t * t * (3 - 2 * t);
    return this.current !== this.to;
  }
}

/**
 * Reads `value` every frame, easing plain numbers over `transition` seconds
 * and following shared values, and calls `apply` when the result changes.
 */
export function useDriven(
  value: Animatable<number>,
  transition: number,
  apply: ((value: number) => void) | null,
) {
  const scene = useScene();
  const read = useAnimatable(value);
  const shared = isShared(value);
  const follower = useMemo(() => new Follower(read()), [read]);
  const applied = useRef<number | null>(null);
  useFrame(({ delta }) => {
    if (!apply) return false;
    const next = read();
    let moving = false;
    if (shared) follower.current = next;
    else {
      follower.target(next, transition);
      moving = follower.step(delta);
    }
    if (applied.current !== follower.current) {
      applied.current = follower.current;
      apply(follower.current);
    }
    return moving;
  });
  // A new `apply`, such as one for a new joint, gets the current value on the next frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `apply` changes with the joint
  useEffect(() => {
    applied.current = null;
    scene.invalidate();
  }, [apply, scene]);
}

export interface JointDriverProps {
  object: THREE.Object3D;
  kit: ModelKit | undefined;
  name: string;
  input: JointInput;
}

export function JointDriver({ object, kit, name, input }: JointDriverProps) {
  const scene = useScene();
  const inline = isInlineJoint(input) ? input : null;
  const fromKit = jointOf(kit, name);
  const {
    value: _,
    select: inlineSelect,
    transition: inlineTransition,
    ...inlineSpec
  }: InlineJoint = inline ?? { value: 0 };
  const spec: JointSpec = { ...fromKit, ...inlineSpec };
  const select = inlineSelect ?? fromKit?.select ?? resolvePart(kit, name);
  const transition = inlineTransition ?? fromKit?.transition ?? 0.6;
  const key = JSON.stringify([select, spec.hinge, spec.axis, spec.range, spec.slide]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the selector and spec
  const joint = useMemo(() => {
    const parts = selectParts(object, select);
    if (parts.length === 0) console.warn(`[apricot] Joint "${name}" matches no part`);
    return new Joint(parts, spec);
  }, [object, key]);
  useEffect(
    () => () => {
      joint.reset();
      scene.invalidate();
    },
    [joint, scene],
  );
  const apply = useMemo(() => (t: number) => joint.set(t), [joint]);
  useDriven(inline ? inline.value : (input as Animatable<number>), transition, apply);
  return null;
}

export interface ClipDriverProps {
  player: ClipPlayer | null;
  name: string;
  input: ClipInput;
}

export function ClipDriver({ player, name, input }: ClipDriverProps) {
  const scene = useScene();
  const mode = input === "once" || input === "loop" ? input : null;
  useEffect(() => {
    if (!player || !mode) return;
    player.play(name, { loop: mode === "loop" });
    scene.invalidate();
    return () => player.stop(name);
  }, [player, name, mode, scene]);
  const apply = useMemo(
    () => (player && !mode ? (t: number) => player.seek(name, t) : null),
    [player, name, mode],
  );
  useDriven(mode ? 0 : (input as Animatable<number>), 0.6, apply);
  return null;
}

export interface MorphDriverProps {
  object: THREE.Object3D;
  name: string;
  input: Animatable<number>;
}

/** Drives a shape key (morph target) on every mesh that has it: 0 = off, 1 = full. */
export function MorphDriver({ object, name, input }: MorphDriverProps) {
  const scene = useScene();
  const targets = useMemo(() => {
    const found: [THREE.Mesh, number][] = [];
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const index = mesh.morphTargetDictionary?.[name];
      if (index !== undefined && mesh.morphTargetInfluences) found.push([mesh, index]);
    });
    return found;
  }, [object, name]);
  useEffect(() => {
    if (targets.length === 0) console.warn(`[apricot] No shape key "${name}" in this model`);
    return () => {
      for (const [mesh, index] of targets) (mesh.morphTargetInfluences as number[])[index] = 0;
      scene.invalidate();
    };
  }, [targets, name, scene]);
  const apply = useMemo(
    () => (t: number) => {
      for (const [mesh, index] of targets) (mesh.morphTargetInfluences as number[])[index] = t;
    },
    [targets],
  );
  useDriven(input, 0.4, apply);
  return null;
}

/** One clip player per model (null without clips), advanced once per frame. */
export function useClipPlayer(object: THREE.Object3D | null, clips: readonly THREE.AnimationClip[]) {
  const player = useMemo(
    () => (object && clips.length > 0 ? new ClipPlayer(object, clips) : null),
    [object, clips],
  );
  useEffect(() => () => player?.dispose(), [player]);
  useFrame(({ delta }) => (player ? player.update(delta) : false));
  return player;
}

/** The kit names that include the hit slot: joints first, then the most specific (fewest slots). */
const partsAt = (object: THREE.Object3D, kit: ModelKit | undefined, hit: PressHit) => {
  if (!kit) return [];
  const found: { key: string; joint: boolean; size: number }[] = [];
  for (const key of Object.keys(kit.parts)) {
    const slots = selectSlots(object, resolvePart(kit, key));
    if (slots.some((s) => s.mesh === hit.mesh && s.index === hit.materialIndex))
      found.push({ key, joint: jointOf(kit, key) !== undefined, size: slots.length });
  }
  // Array.sort is stable, so ties keep the kit's order.
  found.sort((a, b) => Number(b.joint) - Number(a.joint) || a.size - b.size);
  return found.map((f) => f.key);
};

const eventOf = (object: THREE.Object3D, kit: ModelKit | undefined, hit: PressHit): PartPressEvent => {
  const parts = partsAt(object, kit, hit);
  const source = sourceMaterial(hit.mesh, hit.materialIndex);
  return {
    part: parts[0],
    parts,
    name: hit.mesh.name,
    material: source?.name ?? "",
    wearing: hit.material !== source ? hit.material?.name : undefined,
    mesh: hit.mesh,
    point: hit.point,
  };
};

/** Calls `onPress` for taps on `object`'s parts, while given. */
export function usePartPress(
  object: THREE.Object3D | null,
  kit: ModelKit | undefined,
  onPress: ((event: PartPressEvent) => void) | undefined,
) {
  const scene = useScene();
  const latest = useRef(onPress);
  latest.current = onPress;
  const listening = onPress !== undefined;
  useEffect(() => {
    if (!object || !listening) return;
    return scene.presses.add(object, (hit) => latest.current?.(eventOf(object, kit, hit)));
  }, [object, kit, listening, scene]);
}

interface Inspected {
  event: PartPressEvent;
  triangles: number;
  path: string;
}

const pathOf = (mesh: THREE.Object3D, root: THREE.Object3D) => {
  const names: string[] = [];
  for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) if (o.name) names.unshift(o.name);
  return names.join(" › ");
};

const trianglesOf = (mesh: THREE.Mesh) => {
  const geometry = mesh.geometry;
  return Math.round((geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3);
};

const HIGHLIGHT = new THREE.MeshBasicNodeMaterial({
  color: "#ff8a00",
  transparent: true,
  opacity: 0.5,
  depthTest: false,
  name: "apricot:inspect",
});

/**
 * Highlights a tapped part and shows its name, material and the selectors
 * that match it. The same details are logged, for copying into code.
 */
export function PartInspector({ object, kit }: { object: THREE.Object3D; kit: ModelKit | undefined }) {
  const scene = useScene();
  const [inspected, setInspected] = useState<Inspected | null>(null);
  useEffect(
    () =>
      scene.presses.add(object, (hit) => {
        const event = eventOf(object, kit, hit);
        const info = { event, triangles: trianglesOf(hit.mesh), path: pathOf(hit.mesh, object) };
        console.log(
          `[apricot] part "${event.name}" (node:${event.name}) material "${event.material}" (material:${event.material})` +
            (event.wearing ? ` wearing ${event.wearing}` : "") +
            (event.parts.length ? ` kit: ${event.parts.join(", ")}` : "") +
            ` — ${info.triangles} triangles`,
        );
        setInspected(info);
      }),
    [object, kit, scene],
  );
  // The highlight is a translucent orange copy of the tapped mesh, drawn on top.
  useEffect(() => {
    if (!inspected) return;
    const { mesh } = inspected.event;
    const overlay = new THREE.Mesh(mesh.geometry, HIGHLIGHT);
    overlay.name = "apricot:inspect";
    overlay.renderOrder = 999;
    overlay.raycast = () => {};
    mesh.add(overlay);
    scene.invalidate();
    return () => {
      mesh.remove(overlay);
      scene.invalidate();
    };
  }, [inspected, scene]);
  if (!inspected) return null;
  const { event, triangles, path } = inspected;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{event.name || "(unnamed)"}</Text>
      {path !== event.name ? <Text style={styles.line}>{path}</Text> : null}
      <Text style={styles.line}>
        material: {event.material || "(unnamed)"}
        {event.wearing ? ` → ${event.wearing}` : ""}
      </Text>
      {event.parts.length ? <Text style={styles.line}>kit: {event.parts.join(", ")}</Text> : null}
      {event.mesh.morphTargetDictionary ? (
        <Text style={styles.line}>
          shape keys: {Object.keys(event.mesh.morphTargetDictionary).join(", ")}
        </Text>
      ) : null}
      <Text style={styles.line}>{triangles} triangles</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    pointerEvents: "none",
    position: "absolute",
    right: 12,
    // Below the debug HUD.
    top: 44,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    maxWidth: "80%",
  },
  title: { color: "#ffb347", fontWeight: "700", fontSize: 14 },
  line: { color: "#ffffff", fontSize: 12, marginTop: 2 },
});
