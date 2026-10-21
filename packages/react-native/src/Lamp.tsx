import {
  createLampGlowMaterial,
  type LampSource,
  leaveOutOfFootprint,
  setShadow,
  type Vec3,
} from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useDaylight } from "./Daylight";
import { useFrame } from "./hooks";
import { type SceneObject, useAttach } from "./parent";
import { useTransform } from "./transform";

export interface LampProps {
  /** Where the light comes from, such as the bulb, in its parent's space. Put it inside a lamp's model. */
  position?: Vec3;
  /** Colour of the light (default a warm bulb). */
  color?: THREE.ColorRepresentation;
  /** Brightness when on, in candela as for point lights (default 1.5). */
  intensity?: number;
  /** Range in metres (default 3). */
  distance?: number;
  /**
   * Whether it is on (default true). With "dark", it switches on as the
   * scene's <Daylight> gets dark, and stays on in a scene without one.
   * Switching fades.
   */
  on?: boolean | "dark";
  /** Seconds it takes to switch on or off (default 0.6). */
  transition?: number;
  /** Radius in metres of a soft glow around the bulb while it is on (default 0: none). */
  glow?: number;
  ref?: Ref<SceneObject>;
}

const sphere = new THREE.SphereGeometry(1, 16, 12);

/**
 * A light that comes from an object, such as a table lamp's bulb, a candle or
 * a screen. It shines while on (or from dusk, with on="dark" and <Daylight>),
 * can have a glow, and moves with its parent, such as a lamp carried across a
 * room. The scene's `lamps` prop sets how many lamps may light the scene at
 * once. The brightest win, and the others only glow. Lamps cast no shadows.
 *
 *   <Scene lamps={3}>…<Placeable id="lamp">{model}<Lamp position={[0, 0.4, 0]} on="dark" glow={0.18} /></Placeable>
 */
export function Lamp({
  position = [0, 0, 0],
  color = "#ffc98a",
  intensity = 1.5,
  distance = 3,
  on = true,
  transition = 0.6,
  glow = 0,
  ref,
}: LampProps) {
  const scene = useScene();
  const [anchor] = useState(() => {
    const created = new THREE.Group();
    created.name = "Lamp";
    leaveOutOfFootprint(created);
    return created;
  });
  const [source] = useState<LampSource>(() => ({
    object: anchor,
    color: new THREE.Color(color),
    intensity,
    distance,
    level: 0,
  }));
  source.color.set(color);
  source.intensity = intensity;
  source.distance = distance;
  useEffect(() => scene.lamps.add(source), [scene, source]);

  const [halo] = useState(() => {
    const look = createLampGlowMaterial({ color, strength: 0 });
    const mesh = new THREE.Mesh(sphere, look.material);
    mesh.name = "Lamp:glow";
    // The glow is light, not an object: it has no shadow and cannot be tapped.
    setShadow(mesh, { cast: false, receive: false });
    mesh.raycast = () => {};
    anchor.add(mesh);
    return { mesh, look };
  });
  halo.mesh.visible = glow > 0;
  halo.mesh.scale.setScalar(glow > 0 ? glow : 1);
  useEffect(() => () => halo.look.material.dispose(), [halo]);

  useTransform(anchor, { position });
  useImperativeHandle(ref, () => anchor, [anchor]);
  useAttach(anchor);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers, not read inside
  useEffect(() => scene.invalidate(), [scene, on, color, intensity, distance, glow]);
  const daylight = useDaylight();
  const started = useRef(false);
  useFrame(({ delta }) => {
    const wanted = on === "dark" ? (daylight()?.dark ?? 1) : on ? 1 : 0;
    // Start at the wanted level on the first frame, then ease towards it over `transition`.
    const ease = !started.current || transition <= 0 ? 1 : 1 - Math.exp((-delta * 4) / transition);
    started.current = true;
    const from = source.level;
    const next = Math.abs(wanted - from) < 0.002 ? wanted : from + (wanted - from) * ease;
    source.level = next;
    halo.look.set({ color, strength: next });
    // Request frames while the level is changing; the lamp pool reads it as the lamp's brightness.
    return next !== wanted || next !== from;
  });
  return null;
}
