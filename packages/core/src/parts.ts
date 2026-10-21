import type * as THREE from "three/webgpu";

/**
 * Selects parts of a model. A string is a case-insensitive name pattern,
 * where `*` matches any characters and `?` matches one, tested against
 * object names and material names. A prefix narrows the match:
 *   "node:porta_*"         objects with matching names, and everything under them
 *   "material:car_paint*"  only the material slots with a matching material name
 *   "tag:door"             objects tagged in Blender with the custom property `apricot`
 * An array matches any of its selectors.
 */
export type PartSelector = string | readonly string[];

/** A material slot: a mesh and the index of its material (0 for single-material meshes). */
export interface MaterialSlot {
  mesh: THREE.Mesh;
  index: number;
}

const patternCache = new Map<string, RegExp>();

/** A case-insensitive regular expression for a `*` and `?` wildcard pattern. Results are cached. */
export const namePattern = (pattern: string) => {
  let re = patternCache.get(pattern);
  if (!re) {
    const body = pattern
      .split("")
      .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${body}$`, "i");
    patternCache.set(pattern, re);
  }
  return re;
};

type Kind = "any" | "node" | "material" | "tag";

const parse = (selector: string): { kind: Kind; pattern: RegExp } => {
  const colon = selector.indexOf(":");
  const prefix = colon > 0 ? selector.slice(0, colon) : "";
  if (prefix === "node" || prefix === "material" || prefix === "tag") {
    return { kind: prefix, pattern: namePattern(selector.slice(colon + 1)) };
  }
  return { kind: "any", pattern: namePattern(selector) };
};

/** A mesh's materials as an array. */
export const materialsOf = (mesh: THREE.Mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

// The materials meshes had before assignMaterial replaced them, so selectors keep matching the original names.
const originals = new WeakMap<THREE.Mesh, (THREE.Material | undefined)[]>();

/** The material slot `index` of `mesh` had before any assignMaterial call. */
export const sourceMaterial = (mesh: THREE.Mesh, index: number): THREE.Material | undefined =>
  originals.get(mesh)?.[index] ?? materialsOf(mesh)[index];

const sourceMaterials = (mesh: THREE.Mesh) => materialsOf(mesh).map((_, i) => sourceMaterial(mesh, i));

// glTF extras arrive as userData, which is where Blender exports custom properties.
const tagOf = (object: THREE.Object3D) => object.userData?.apricot as string | undefined;

// Whether `object` or one of its ancestors up to and including `root` passes `test`.
const isUnder = (object: THREE.Object3D, root: THREE.Object3D, test: (o: THREE.Object3D) => boolean) => {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (test(o)) return true;
    if (o === root) break;
  }
  return false;
};

/**
 * The material slots `selector` selects under `root`. Name and tag matches
 * select every slot of the meshes in and under the matched objects.
 * Material matches select only the slots using that material.
 */
export const selectSlots = (root: THREE.Object3D, selector: PartSelector): MaterialSlot[] => {
  const rules = (typeof selector === "string" ? [selector] : selector).map(parse);
  const slots: MaterialSlot[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = sourceMaterials(mesh);
    materials.forEach((material, index) => {
      const hit = rules.some(({ kind, pattern }) => {
        const byNode =
          (kind === "any" || kind === "node") && isUnder(mesh, root, (o) => pattern.test(o.name));
        const byMaterial = (kind === "any" || kind === "material") && pattern.test(material?.name ?? "");
        const byTag = kind === "tag" && isUnder(mesh, root, (o) => pattern.test(tagOf(o) ?? "\u0000"));
        return byNode || byMaterial || byTag;
      });
      if (hit) slots.push({ mesh, index });
    });
  });
  return slots;
};

/**
 * The objects `selector` selects under `root`, such as the parts a joint
 * moves. Descendants of a matched object are not listed. Material patterns
 * select the meshes that use the material.
 */
export const selectParts = (root: THREE.Object3D, selector: PartSelector): THREE.Object3D[] => {
  const rules = (typeof selector === "string" ? [selector] : selector).map(parse);
  const found: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D) => {
    const hit = rules.some(({ kind, pattern }) => {
      if ((kind === "any" || kind === "node") && pattern.test(object.name)) return true;
      if (kind === "tag" && pattern.test(tagOf(object) ?? "\u0000")) return true;
      const mesh = object as THREE.Mesh;
      return (
        kind === "material" &&
        mesh.isMesh === true &&
        sourceMaterials(mesh).some((m) => pattern.test(m?.name ?? ""))
      );
    });
    if (hit && object !== root) {
      found.push(object);
      return;
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return found;
};

/**
 * Replaces the material in each slot, leaving the other slots of
 * multi-material meshes unchanged. Selectors still match a slot by its
 * original material's name.
 */
export const assignMaterial = (slots: readonly MaterialSlot[], material: THREE.Material) => {
  for (const { mesh, index } of slots) {
    if (!originals.has(mesh)) originals.set(mesh, materialsOf(mesh).slice());
    if (Array.isArray(mesh.material)) {
      const next = mesh.material.slice();
      next[index] = material;
      mesh.material = next;
    } else {
      mesh.material = material;
    }
  }
};
