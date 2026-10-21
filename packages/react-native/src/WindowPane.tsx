import { setShadow } from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useDaylight } from "./Daylight";
import { useFrame } from "./hooks";
import { type SceneObject, useAttach } from "./parent";
import { type TransformProps, useTransform } from "./transform";

export interface WindowPaneProps extends Pick<TransformProps, "position" | "rotation"> {
  /** Width and height of the glass, in metres. It is one centimetre thick along its local z. */
  size: readonly [number, number];
  /** Its colour by day, glowing with the light outside (default a warm white). */
  day?: THREE.ColorRepresentation;
  /** Its colour at night (default a deep blue). */
  night?: THREE.ColorRepresentation;
  ref?: Ref<SceneObject>;
}

const box = new THREE.BoxGeometry(1, 1, 1);

/**
 * The glass of a window seen from inside. It is bright by day and deep blue
 * at night, following the scene's <Daylight>, and stays in its day colour
 * without one. Pair it with <LightBeam sun> for the light coming through.
 */
export function WindowPane({
  size,
  position,
  rotation,
  day = "#ffdca3",
  night = "#2b3566",
  ref,
}: WindowPaneProps) {
  const scene = useScene();
  const [mesh] = useState(() => {
    const created = new THREE.Mesh(box, new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0 }));
    created.name = "WindowPane";
    // Light passes through the glass, so it casts no shadow.
    setShadow(created, { cast: false, receive: false });
    return created;
  });
  const material = mesh.material as THREE.MeshStandardNodeMaterial;
  useEffect(() => () => material.dispose(), [material]);
  mesh.scale.set(size[0], size[1], 0.01);
  useTransform(mesh, { position, rotation });
  useImperativeHandle(ref, () => mesh, [mesh]);
  useAttach(mesh);

  const colors = useMemo(() => ({ day: new THREE.Color(day), night: new THREE.Color(night) }), [day, night]);
  const daylight = useDaylight();
  const shown = useRef<{ dark: number; colors: typeof colors } | null>(null);
  useFrame(() => {
    const dark = daylight()?.dark ?? 0;
    if (shown.current?.dark === dark && shown.current.colors === colors) return false;
    shown.current = { dark, colors };
    material.color.copy(colors.day).lerp(colors.night, dark);
    material.emissive.copy(material.color);
    // A strong glow by day, a faint one at night.
    material.emissiveIntensity = 2 - dark * 1.5;
    scene.invalidate();
    return false;
  });
  return null;
}
