import {
  type InstanceItem,
  type InstancePart,
  InstanceSet,
  instanceParts,
  type PressHit,
} from "@apricotjs/core";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { type MaterialInput, useMaterialInput } from "./materials";
import { ParentContext, useAttach } from "./parent";
import { type ShadowProps, useShadowChoice } from "./shadow";
import { type TransformProps, useTransform } from "./transform";

export interface InstancePressEvent<T extends InstanceItem = InstanceItem> {
  /** Index of the tapped copy in `items`. */
  index: number;
  item: T;
  hit: PressHit;
}

export interface InstancesHandle {
  /** The group holding the copies. Move it like any object. */
  readonly group: THREE.Group;
  /** Changes one copy immediately, without a React render, for example to animate it from useFrame. */
  set(index: number, item: InstanceItem): void;
}

export interface InstancesProps<T extends InstanceItem = InstanceItem> extends TransformProps, ShadowProps {
  /**
   * The copies, each with an optional position, rotation, scale, color and
   * visible. Other fields are kept and passed back in press events.
   */
  items: readonly T[];
  /** The shape to copy. Alternatively, use `object` or children. */
  geometry?: THREE.BufferGeometry;
  /** An object whose meshes are copied, such as a loaded model (`useModel(src).object`). */
  object?: THREE.Object3D | null;
  /**
   * Shapes to copy together as one, such as a seat made of two boxes. Their
   * positions place them within each copy.
   *
   *   <Instances items={seats}>
   *     <Box size={[0.9, 0.25, 0.85]} position={[0, 0.45, 0]} />
   *     <Box size={[0.9, 0.9, 0.18]} position={[0, 0.85, 0.42]} />
   *   </Instances>
   */
  children?: ReactNode;
  /**
   * The copies' material, as for <Mesh> (default "standard"). With `object`
   * or children, their own materials are used unless this or `color` is set.
   */
  material?: MaterialInput;
  /** The material's colour. Defaults to white when copies have their own colours, so those show unchanged. */
  color?: THREE.ColorRepresentation;
  /** Called with the copy that was tapped. */
  onPress?: (event: InstancePressEvent<T>) => void;
  name?: string;
  visible?: boolean;
  ref?: Ref<InstancesHandle>;
}

/**
 * Draws many copies of one shape for about the cost of one, such as cinema
 * seats, trees, coins or products on a shelf. Every separate mesh costs CPU
 * time each frame, while each extra copy adds almost nothing. Taps report
 * which copy was hit.
 *
 *   <Instances
 *     geometry={seat}
 *     material="plastic"
 *     items={seats.map((s) => ({ position: s.at, color: s.taken ? "#9aa0a6" : "#1f9d55" }))}
 *     onPress={({ index }) => book(index)}
 *   />
 */
export function Instances<T extends InstanceItem = InstanceItem>({
  items,
  geometry,
  object: given,
  children,
  material,
  color,
  onPress,
  name,
  visible = true,
  ref,
  castShadow,
  receiveShadow,
  shadowOnly,
  ...transform
}: InstancesProps<T>) {
  const scene = useScene();
  // Children mount into a template that is never shown; its meshes are copied.
  const [template] = useState(() => new THREE.Group());
  const [templateWatch] = useState(() => new TemplateWatch());
  const [templateVersion, setTemplateVersion] = useState(0);
  const copying = children !== undefined && children !== null;
  // Shapes position themselves in frame callbacks, so check the template each frame.
  useFrame(() => {
    if (copying && templateWatch.changed(template)) setTemplateVersion((n) => n + 1);
  });
  const object = copying ? (templateVersion > 0 ? template : null) : given;
  const tinted = items.some((item) => item.color !== undefined);
  const chosen = useMaterialInput(material, color ?? (tinted ? "#ffffff" : undefined));
  // A material or colour given here is for every part; otherwise the parts keep their own.
  const override = material !== undefined || color !== undefined || (!object && !copying);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `templateVersion` changes when the template's meshes do
  const parts = useMemo<InstancePart[]>(() => {
    if (object) {
      const found = instanceParts(object);
      return override ? found.map((part) => ({ ...part, material: chosen })) : found;
    }
    return geometry && !copying ? [{ geometry, material: chosen, offset: new THREE.Matrix4() }] : [];
  }, [object, geometry, chosen, override, copying, templateVersion]);

  // Sized for the first items; it grows if more come later.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new set only for a new shape, not for more copies
  const set = useMemo(() => new InstanceSet(parts, items.length), [parts]);
  useEffect(() => () => set.dispose(), [set]);

  // Written during render (like <Mesh> props), so the next frame shows them.
  const written = useRef<{ set: InstanceSet; items: readonly T[] } | null>(null);
  if (written.current?.set !== set || written.current.items !== items) {
    set.setItems(items);
    written.current = { set, items };
  }
  set.group.name = name ?? "";
  set.group.visible = visible;

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the changes that need a frame
  useEffect(() => {
    scene.invalidate();
  }, [scene, set, items, visible]);

  useImperativeHandle(
    ref,
    () => ({
      group: set.group,
      set: (index, item) => {
        set.set(index, item);
        scene.invalidate();
      },
    }),
    [set, scene],
  );
  useShadowChoice(set.instancedMeshes, { castShadow, receiveShadow, shadowOnly });
  useAttach(set.group);
  useTransform(set.group, transform);

  const press = useRef({ onPress, items });
  press.current = { onPress, items };
  const listening = onPress !== undefined;
  useEffect(() => {
    if (!listening) return;
    return scene.presses.add(set.group, (hit) => {
      const index = set.indexOf(hit);
      const { onPress: handler, items: current } = press.current;
      if (index !== null && current[index]) handler?.({ index, item: current[index], hit });
    });
  }, [scene, set, listening]);
  return copying ? <ParentContext.Provider value={template}>{children}</ParentContext.Provider> : null;
}

/** Tracks the geometry, materials and world matrix of a template's visible meshes, without allocating. */
class TemplateWatch {
  private parts: unknown[] = [];
  private places: number[] = [];

  /** Whether anything tracked changed since the last call. */
  changed(template: THREE.Object3D) {
    template.updateWorldMatrix(true, true);
    let changed = false;
    let p = 0;
    let m = 0;
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const part of [mesh.geometry, ...materials]) {
        if (this.parts[p] !== part) {
          this.parts[p] = part;
          changed = true;
        }
        p++;
      }
      for (const e of mesh.matrixWorld.elements) {
        if (this.places[m] !== e) {
          this.places[m] = e;
          changed = true;
        }
        m++;
      }
    });
    if (this.parts.length !== p || this.places.length !== m) {
      this.parts.length = p;
      this.places.length = m;
      changed = true;
    }
    return changed;
  }
}
