import type { JointSpec, PartSelector } from "@apricotjs/core";
import type { ModelSource } from "./model/files";

/** A moving part: what to select, where it turns or slides, and how far. See JointSpec for the hinge options. */
export interface JointPart extends JointSpec {
  /** The parts that move together. */
  select: PartSelector;
  /** Seconds a change of a plain value takes. Shared values are followed exactly. Default 0.6. */
  transition?: number;
}

/** A part of a model kit: a selector, or a joint. */
export type KitPart = PartSelector | JointPart;

/** A model plus your own names for its parts. See defineModelKit. */
export interface ModelKit<P extends string = string> {
  src: ModelSource;
  parts: Record<P, KitPart>;
}

/**
 * Names the parts of a model once, so app code does not depend on the names
 * in the file, such as `ruota_ant_sx` or `Object_123`. Replacing the model
 * then only means changing the kit. Part names autocomplete in <Model kit>.
 *
 *   const civic = defineModelKit(require("./civic.glb"), {
 *     paint: "material:Vernice*",
 *     wheels: "ruota_*",
 *     doorLeft: { select: "porta_ant_sx", hinge: "front", axis: "y", range: [0, 70] },
 *   });
 */
export const defineModelKit = <const P extends string>(
  src: ModelSource,
  parts: Record<P, KitPart>,
): ModelKit<P> => ({
  src,
  parts,
});

const isJoint = (part: KitPart): part is JointPart =>
  typeof part === "object" && !Array.isArray(part) && "select" in part;

/** The selector for a kit part name, or the key itself as a selector if the kit does not define it. */
export const resolvePart = (kit: ModelKit | undefined, key: string): PartSelector => {
  const part = kit?.parts[key];
  if (part === undefined) return key;
  return isJoint(part) ? part.select : part;
};

/** The joint for a kit part name, or undefined if the part is not a joint. */
export const jointOf = (kit: ModelKit | undefined, key: string): JointPart | undefined => {
  const part = kit?.parts[key];
  return part !== undefined && isJoint(part) ? part : undefined;
};
