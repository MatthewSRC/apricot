import { mergeColoredParts } from "@apricotjs/core";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { bakedIn, ParentContext, type SceneObject, useAttach } from "./parent";
import { type ShadowProps, useShadowChoice } from "./shadow";
import { type TransformProps, useTransform } from "./transform";

export interface MergedProps extends TransformProps, ShadowProps {
  /** Roughness of the merged surfaces, from 0 (glossy) to 1 (matte) (default 0.7). */
  roughness?: number;
  ref?: Ref<SceneObject>;
  children?: ReactNode;
}

const MERGED = "Merged";

// Milliseconds of baking per frame in a paused scene that is preparing unseen, so the visible
// scene keeps animating.
const BAKE_BUDGET = 8;
const bakingTime = new WeakMap<object, { frame: number; ms: number }>();

interface Part {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  matrix: THREE.Matrix4;
}

/** Shows a shape that is no longer baked in as it would be on its own. */
const unbake = (o: THREE.Object3D) => {
  o.visible = bakedIn.get(o) ?? true;
  bakedIn.delete(o);
};

/** Whether a mesh can be baked in: plain coloured, opaque, and not metal, glowing or textured. */
const mergeable = (mesh: THREE.Mesh) => {
  const instanced = mesh as THREE.InstancedMesh & THREE.SkinnedMesh;
  if (instanced.isInstancedMesh || instanced.isSkinnedMesh || mesh.name === MERGED) return false;
  const m = mesh.material as THREE.MeshPhysicalNodeMaterial;
  if (Array.isArray(mesh.material) || !m.color || m.map || m.transparent || m.vertexColors) return false;
  if ((m.metalness ?? 0) > 0.1 || (m.transmission ?? 0) > 0 || (m.clearcoat ?? 0) > 0) return false;
  if (m.emissiveNode || (m.emissive && m.emissive.getHex() !== 0)) return false;
  return true;
};

/** The meshes under `group` that `mesh` should draw, with their transforms relative to `group`. */
const collectParts = (group: THREE.Object3D, mesh: THREE.Mesh) => {
  group.updateWorldMatrix(true, true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const parts: Part[] = [];
  const meshes = new Set<THREE.Object3D>();
  group.traverse((o) => {
    const part = o as THREE.Mesh;
    if (!part.isMesh || part === mesh || !mergeable(part)) return;
    // Skip shapes hidden by their own `visible`, as opposed to hidden by being baked in.
    if (!(bakedIn.get(part) ?? part.visible)) return;
    // A nested <Merged> draws its own shapes.
    for (let p = part.parent; p && p !== group; p = p.parent)
      if (p.children.some((c) => c.name === MERGED)) return;
    parts.push({
      geometry: part.geometry,
      color: (part.material as THREE.MeshStandardMaterial).color,
      matrix: new THREE.Matrix4().multiplyMatrices(toGroup, part.matrixWorld),
    });
    meshes.add(part);
  });
  return { parts, meshes };
};

const mix = (hash: number, value: number) => (Math.imul(hash, 31) + value) | 0;

/**
 * A hash of the parts' geometries, colours and transforms (to a tenth of a
 * millimetre), so checking hundreds of parts after a render is cheap.
 */
const signatureOf = (parts: readonly Part[]) => {
  let signature = parts.length;
  for (const p of parts) {
    signature = mix(signature, p.geometry.id);
    signature = mix(signature, p.color.getHex());
    for (const e of p.matrix.elements) signature = mix(signature, Math.round(e * 1e4));
  }
  return signature;
};

/**
 * Draws the shapes inside as one mesh, so a piece of furniture made of twenty
 * boxes and cylinders costs one draw call instead of twenty. Their colours are
 * baked in. Glowing, transparent, metal and textured shapes are drawn on their
 * own as usual. Use it for things that keep their shape: it bakes again when
 * it re-renders with different shapes, but not when a shape inside animates
 * on its own. Taps on any part reach whatever holds it, such as a <Placeable>.
 *
 *   <Merged>
 *     <Box size={[1.6, 0.25, 0.75]} position={[0, 0.2, 0]} color="#e8939b" />
 *     <Box size={[1.6, 0.5, 0.18]} position={[0, 0.55, -0.3]} color="#e8939b" />
 *   </Merged>
 */
export function Merged({
  roughness = 0.7,
  ref,
  children,
  castShadow,
  receiveShadow,
  shadowOnly,
  ...transform
}: MergedProps) {
  const scene = useScene();
  const [group] = useState(() => new THREE.Group());
  const [mesh] = useState(() => {
    const created = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness }),
    );
    created.name = MERGED;
    // Hidden until the first bake gives it geometry.
    created.visible = false;
    return created;
  });
  (mesh.material as THREE.MeshStandardNodeMaterial).roughness = roughness;
  const [baked] = useState(() => ({ signature: Number.NaN, hidden: new Set<THREE.Object3D>(), dirty: true }));
  useImperativeHandle(ref, () => group, [group]);
  useAttach(group);
  useTransform(group, transform);
  const [shadowed] = useState(() => [mesh]);
  useShadowChoice(shadowed, { castShadow, receiveShadow, shadowOnly });
  useEffect(() => {
    group.add(mesh);
    return () => {
      // Shapes that outlive this component (moved elsewhere) show on their own again.
      for (const o of baked.hidden) unbake(o);
      baked.hidden.clear();
      group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    };
  }, [group, mesh, baked]);

  // The shapes inside may differ after any render. Check in the next frame, after the shapes have
  // applied their transforms in earlier frame callbacks.
  useEffect(() => {
    baked.dirty = true;
    scene.invalidate();
  });
  useFrame(({ frame }) => {
    if (!baked.dirty) return false;
    // In a paused scene, continue in the next frame once this frame's budget is spent.
    const spent = bakingTime.get(scene);
    if (scene.isPaused && spent?.frame === frame && spent.ms >= BAKE_BUDGET) {
      scene.invalidate();
      return false;
    }
    const started = performance.now();
    baked.dirty = false;
    const { parts, meshes } = collectParts(group, mesh);
    const signature = signatureOf(parts);
    // Unbake shapes that dropped out (removed, or now transparent). Hide the baked ones so that
    // renderers and shadows skip them; taps reach the merged mesh instead.
    for (const o of baked.hidden) if (!meshes.has(o)) unbake(o);
    for (const o of meshes)
      if (!bakedIn.has(o)) {
        bakedIn.set(o, o.visible);
        o.visible = false;
      }
    baked.hidden = meshes;
    if (signature !== baked.signature) {
      baked.signature = signature;
      mesh.geometry.dispose();
      mesh.geometry = parts.length ? mergeColoredParts(parts) : new THREE.BufferGeometry();
      mesh.visible = parts.length > 0;
      mesh.geometry.computeBoundingBox();
      scene.requestWarmUp(mesh);
    }
    const ms = performance.now() - started;
    bakingTime.set(scene, { frame, ms: spent?.frame === frame ? spent.ms + ms : ms });
    return false;
  });

  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}
