import { createSlabGeometry, type Outline, type PressHit, type Vec3 } from "@apricotjs/core";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { type MaterialInput, useMaterialInput } from "./materials";
import { bakedIn, ParentContext, type SceneObject, useAttach } from "./parent";
import { type ShadowProps, useShadowChoice } from "./shadow";
import { useSharedGeometry } from "./sharedGeometry";
import { type TransformProps, useTransform } from "./transform";

export interface MeshProps extends TransformProps, ShadowProps {
  /** The shape. The mesh does not dispose it. */
  geometry: THREE.BufferGeometry;
  /**
   * The material: a preset name ("chrome", "car-paint", "glass"…), a preset
   * with options (`{ preset: "gold", roughness: 0.3 }`), or any three.js
   * material, which the mesh does not dispose. Default "standard", a light grey.
   */
  material?: MaterialInput;
  /** Overrides the material's colour. Changes animate. */
  color?: THREE.ColorRepresentation;
  name?: string;
  visible?: boolean;
  /** Called when the mesh is tapped. */
  onPress?: (hit: PressHit) => void;
  ref?: Ref<SceneObject>;
  children?: ReactNode;
}

/**
 * Any geometry with a preset material or your own. It is added to its parent
 * while mounted, and a material it creates is disposed on unmount. For
 * ready-made shapes see <Box>, <Sphere>, <Cylinder>, <Cone>, <Plane>,
 * <Torus>, <Capsule> and <Slab>.
 */
export function Mesh({
  geometry,
  material,
  color,
  name,
  visible = true,
  onPress,
  ref,
  children,
  castShadow,
  receiveShadow,
  shadowOnly,
  ...transform
}: MeshProps) {
  const scene = useScene();
  const [mesh] = useState(() => new THREE.Mesh());
  const resolved = useMaterialInput(material, color);

  mesh.geometry = geometry;
  mesh.material = resolved;
  mesh.name = name ?? "";
  if (bakedIn.has(mesh)) bakedIn.set(mesh, visible);
  else mesh.visible = visible;
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the changes that need a new frame
  useEffect(() => {
    scene.invalidate();
    scene.requestWarmUp(mesh);
  }, [scene, mesh, geometry, resolved, visible]);

  useImperativeHandle(ref, () => mesh, [mesh]);
  const [shadowed] = useState(() => [mesh]);
  useShadowChoice(shadowed, { castShadow, receiveShadow, shadowOnly });
  useAttach(mesh);
  useTransform(mesh, transform);

  const press = useRef(onPress);
  press.current = onPress;
  const listening = onPress !== undefined;
  useEffect(() => {
    if (!listening) return;
    return scene.presses.add(mesh, (hit) => press.current?.(hit));
  }, [scene, mesh, listening]);

  return <ParentContext.Provider value={mesh}>{children}</ParentContext.Provider>;
}

type ShapeProps = Omit<MeshProps, "geometry">;

const size3 = (size: number | Vec3): Vec3 => (typeof size === "number" ? [size, size, size] : size);

export interface BoxProps extends ShapeProps {
  /** Width, height, depth, or one number for a cube (default 1). */
  size?: number | Vec3;
  /** Rounds the edges and corners (default 0: sharp). */
  radius?: number;
}

/** A box, centred on its position. */
export function Box({ size = 1, radius = 0, ...props }: BoxProps) {
  const [w, h, d] = size3(size);
  const geometry = useSharedGeometry(
    "box",
    () =>
      radius > 0
        ? new RoundedBoxGeometry(w, h, d, 4, Math.min(radius, w / 2, h / 2, d / 2))
        : new THREE.BoxGeometry(w, h, d),
    [w, h, d, radius],
  );
  return <Mesh geometry={geometry} {...props} />;
}

export interface SphereProps extends ShapeProps {
  /** Default 0.5. */
  radius?: number;
  /** Segments around the sphere (default 32). */
  segments?: number;
}

/** A sphere, centred on its position. */
export function Sphere({ radius = 0.5, segments = 32, ...props }: SphereProps) {
  const geometry = useSharedGeometry(
    "sphere",
    () => new THREE.SphereGeometry(radius, segments, Math.max(2, Math.round(segments / 2))),
    [radius, segments],
  );
  return <Mesh geometry={geometry} {...props} />;
}

export interface CylinderProps extends ShapeProps {
  /** Default 0.5. */
  radius?: number;
  /** Radius at the top, if different (a tapered cylinder). */
  radiusTop?: number;
  /** Height along y (default 1). */
  height?: number;
  segments?: number;
}

/** A cylinder standing along y, centred on its position. */
export function Cylinder({ radius = 0.5, radiusTop, height = 1, segments = 32, ...props }: CylinderProps) {
  const geometry = useSharedGeometry(
    "cylinder",
    () => new THREE.CylinderGeometry(radiusTop ?? radius, radius, height, segments),
    [radius, radiusTop, height, segments],
  );
  return <Mesh geometry={geometry} {...props} />;
}

/** A cone pointing up (+y), centred on its position. */
export function Cone({
  radius = 0.5,
  height = 1,
  segments = 32,
  ...props
}: Omit<CylinderProps, "radiusTop">) {
  const geometry = useSharedGeometry("cone", () => new THREE.ConeGeometry(radius, height, segments), [
    radius,
    height,
    segments,
  ]);
  return <Mesh geometry={geometry} {...props} />;
}

export interface PlaneProps extends ShapeProps {
  /** Width and height, or one number for a square (default 1). */
  size?: number | readonly [number, number];
}

/** A flat rectangle facing +z (rotate it by [-Math.PI / 2, 0, 0] for a floor). */
export function Plane({ size = 1, ...props }: PlaneProps) {
  const [w, h] = typeof size === "number" ? [size, size] : size;
  const geometry = useSharedGeometry("plane", () => new THREE.PlaneGeometry(w, h), [w, h]);
  return <Mesh geometry={geometry} {...props} />;
}

export interface SlabProps extends ShapeProps {
  /** The shape on the ground: (x, z) corners in metres. Use smoothOutline for rounded edges. */
  outline: Outline;
  /** Thickness, upwards from its position (default 0.2). */
  height?: number;
  /** Outlines cut through it, such as a pool in a deck. */
  holes?: readonly Outline[];
  /** Edge rounding in metres (default 0.03). */
  bevel?: number;
}

/** A flat slab in any outline, such as an island, a lawn or a deck. Its top is at `height`. */
export function Slab({ outline, height = 0.2, holes, bevel = 0.03, ...props }: SlabProps) {
  const geometry = useSharedGeometry("slab", () => createSlabGeometry(outline, { height, holes, bevel }), [
    JSON.stringify(outline),
    height,
    JSON.stringify(holes ?? []),
    bevel,
  ]);
  return <Mesh geometry={geometry} {...props} />;
}

export interface TorusProps extends ShapeProps {
  /** Distance from the centre to the middle of the tube (default 0.5). */
  radius?: number;
  /** Thickness of the tube (default 0.15). */
  tube?: number;
  segments?: number;
}

/** A ring (doughnut) in the xy plane, centred on its position. */
export function Torus({ radius = 0.5, tube = 0.15, segments = 48, ...props }: TorusProps) {
  const geometry = useSharedGeometry(
    "torus",
    () => new THREE.TorusGeometry(radius, tube, Math.max(8, Math.round(segments / 3)), segments),
    [radius, tube, segments],
  );
  return <Mesh geometry={geometry} {...props} />;
}

export interface CapsuleProps extends ShapeProps {
  /** Default 0.3. */
  radius?: number;
  /** Length of the straight middle, along y (default 0.6). */
  length?: number;
  segments?: number;
}

/** A pill along y, centred on its position. */
export function Capsule({ radius = 0.3, length = 0.6, segments = 16, ...props }: CapsuleProps) {
  const geometry = useSharedGeometry(
    "capsule",
    () => new THREE.CapsuleGeometry(radius, length, Math.max(4, Math.round(segments / 2)), segments),
    [radius, length, segments],
  );
  return <Mesh geometry={geometry} {...props} />;
}
