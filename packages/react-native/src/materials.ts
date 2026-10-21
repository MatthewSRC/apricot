import {
  assignMaterial,
  type MaterialOptions,
  type PartSelector,
  PresetMaterial,
  selectSlots,
} from "@apricotjs/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import { watchInside } from "./bounds";
import { useScene } from "./context";
import { useFrame } from "./hooks";

/**
 * A material for a part: a preset name such as "chrome", a preset with
 * options such as `{ preset: "car-paint", color: "#1f4fd1" }`, or any
 * three.js material. Changes to colour, roughness and metalness animate over
 * `transition` seconds (default 0.4) without rebuilding the shader.
 */
export type MaterialInput =
  | string
  | ({ preset: string; transition?: number } & MaterialOptions)
  | THREE.Material;

/** Materials keyed by part selector or model kit part name. */
export type MaterialOverrides = Record<string, MaterialInput>;

/** Whether a material input is a three.js material, which is used as it is. */
export const isMaterial = (input: MaterialInput | undefined): input is THREE.Material =>
  typeof input === "object" && (input as THREE.Material).isMaterial === true;

// Objects with a uuid, such as TSL nodes and textures, are keyed by their uuid.
// JSON.stringify calls their toJSON before any replacer, which would serialize
// their images and warn "Unable to serialize Texture".
const byIdentity = (value: unknown) =>
  value !== null && typeof value === "object" && typeof (value as { uuid?: unknown }).uuid === "string"
    ? `#${(value as { uuid: string }).uuid}`
    : value;

// A key for everything that needs a new material when it changes, which is all but the animated values.
const structureOf = (input: MaterialInput) => {
  if (typeof input === "string") return input;
  if (isMaterial(input)) return `material:${input.uuid}`;
  const { preset, map, engrave, side, vertexColors, physical } = input;
  return JSON.stringify([
    preset,
    side ?? null,
    vertexColors ?? false,
    map?.uuid ?? null,
    engrave ? [engrave.mask.uuid, engrave.color, engrave.roughness, engrave.metalness] : null,
    physical ? Object.entries(physical).map(([key, value]) => [key, byIdentity(value)]) : null,
  ]);
};

const liveOf = (input: MaterialInput) =>
  typeof input === "string" || isMaterial(input)
    ? null
    : { color: input.color, roughness: input.roughness, metalness: input.metalness };

const hasMeshes = (object: THREE.Object3D) => {
  let found = false;
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found = true;
  });
  return found;
};

/**
 * Applies material overrides to the parts of `object` while mounted, and
 * puts the original materials back afterwards. `resolve` turns a key into a
 * selector (model kits map their part names).
 */
export function useMaterialOverrides(
  object: THREE.Object3D | null,
  overrides: MaterialOverrides | undefined,
  resolve: (key: string) => PartSelector = (key) => key,
) {
  const scene = useScene();
  const handles = useRef(new Map<string, PresetMaterial>());
  const entries = Object.entries(overrides ?? {});
  const structure = JSON.stringify(entries.map(([key, input]) => [key, structureOf(input)]));
  const latest = useRef({ entries, resolve });
  latest.current = { entries, resolve };
  // Re-applied when objects are added inside, such as a nested model that finished loading.
  const [arrivals, setArrivals] = useState(0);
  const warned = useRef(new Set<string>());
  useEffect(() => (object ? watchInside(object, () => setArrivals((n) => n + 1)) : undefined), [object]);

  // Builds and assigns the materials, and restores the originals on change or unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `structure` stands for the entries' fixed parts, `arrivals` for objects added since
  useEffect(() => {
    if (!object) return;
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const created: PresetMaterial[] = [];
    for (const [key, input] of latest.current.entries) {
      const slots = selectSlots(object, latest.current.resolve(key));
      // No warning while the object has no meshes yet; they get the material when they arrive.
      if (slots.length === 0 && !warned.current.has(key) && hasMeshes(object)) {
        warned.current.add(key);
        console.warn(`[apricot] Material override "${key}" matches no part`);
      }
      for (const { mesh } of slots) if (!originals.has(mesh)) originals.set(mesh, mesh.material);
      let material: THREE.Material;
      if (typeof input === "string") {
        const handle = new PresetMaterial(input);
        created.push(handle);
        material = handle.material;
      } else if (isMaterial(input)) {
        material = input;
      } else {
        const { preset, transition: _, ...options } = input;
        const handle = new PresetMaterial(preset, options);
        created.push(handle);
        handles.current.set(key, handle);
        material = handle.material;
      }
      assignMaterial(slots, material);
    }
    scene.invalidate();
    scene.requestWarmUp(object);
    return () => {
      for (const [mesh, material] of originals) mesh.material = material;
      for (const handle of created) handle.dispose();
      handles.current.clear();
      scene.invalidate();
    };
  }, [object, structure, scene, arrivals]);

  // New colour, roughness and metalness values animate on the existing materials.
  const live = JSON.stringify(entries.map(([key, input]) => [key, liveOf(input)]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `live` stands for the entries' live values
  useEffect(() => {
    let changed = false;
    for (const [key, input] of latest.current.entries) {
      const handle = handles.current.get(key);
      const values = liveOf(input);
      if (!handle || !values || typeof input !== "object" || isMaterial(input)) continue;
      handle.animateTo(values, input.transition ?? 0.4);
      changed = true;
    }
    if (changed) scene.invalidate();
  }, [live, scene]);

  useFrame(({ delta }) => {
    let active = false;
    for (const handle of handles.current.values()) if (handle.step(delta)) active = true;
    return active;
  });
}

// Components with the same preset and values share one material, because each
// distinct material costs a shader build. Shared materials are reference counted
// and disposed after their last user unmounts.
interface SharedMaterial {
  handle: PresetMaterial;
  users: number;
  /** The frame it was last stepped in, so a shared animation advances once per frame. */
  stepped: number;
}
const sharedMaterials = new Map<string, SharedMaterial>();

/** The number of materials currently shared between components. For diagnostics and tests. */
export const sharedMaterialCount = () => sharedMaterials.size;

const lookup = (key: string, make: () => PresetMaterial) => {
  let entry = sharedMaterials.get(key);
  if (!entry) {
    entry = { handle: make(), users: 0, stepped: -1 };
    sharedMaterials.set(key, entry);
  }
  return entry;
};

/**
 * A preset material for your own meshes. Components asking for the same
 * preset and values share one material and one shader build. Changes to
 * colour, roughness and metalness animate over `transition` seconds
 * (default 0.4). The material is disposed when its last user unmounts.
 */
export function useMaterial(
  preset: string,
  { transition = 0.4, ...options }: MaterialOptions & { transition?: number } = {},
) {
  const scene = useScene();
  const latest = useRef(options);
  latest.current = options;
  const structure = structureOf({ preset, ...options });
  const live = JSON.stringify(liveOf({ preset, ...options }));
  const key = `${structure}|${live}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the preset and options
  const entry = useMemo(() => lookup(key, () => new PresetMaterial(preset, latest.current)), [key]);
  const previous = useRef<{ structure: string; values: PresetMaterial["values"] } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` covers structure and values
  useEffect(() => {
    const fresh = entry.users === 0;
    entry.users++;
    // Re-inserted in case the last user of this key released it in between.
    sharedMaterials.set(key, entry);
    // When only the values changed and no other component shares the new material, it animates from the old values.
    const before = previous.current;
    if (fresh && before && before.structure === structure && transition > 0) {
      entry.handle.set(before.values);
      entry.handle.animateTo(latest.current, transition);
    }
    scene.invalidate();
    return () => {
      previous.current = { structure, values: entry.handle.values };
      entry.users--;
      if (entry.users === 0 && sharedMaterials.get(key) === entry) {
        sharedMaterials.delete(key);
        entry.handle.dispose();
      }
    };
  }, [entry, key, scene]);

  // Stepped once per frame, however many components share it.
  useFrame(({ delta, frame }) => {
    if (entry.stepped === frame) return false;
    entry.stepped = frame;
    return entry.handle.step(delta);
  });
  return entry.handle.material;
}

/**
 * Resolves a component's `material` prop and `color` shortcut to the
 * material to draw with. Presets go through useMaterial, so they are shared
 * and colour changes animate. A three.js material is used as it is. The
 * default preset is "standard".
 */
export function useMaterialInput(material: MaterialInput | undefined, color?: THREE.ColorRepresentation) {
  const own = isMaterial(material) ? null : material;
  const { preset, transition, ...options } =
    typeof own === "string" ? { preset: own } : (own ?? { preset: "standard" });
  const made = useMaterial(preset, { transition, ...options, ...(color !== undefined ? { color } : {}) });
  return isMaterial(material) ? material : made;
}
