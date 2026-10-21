import { stepSpin, type Vec3 } from "@apricotjs/core";
import { defineBehavior } from "./behavior";

/**
 * Spins its children at `speed` radians per second (default 1) around `axis`
 * (default +Y). Both accept shared values, such as a speed driven by a gesture.
 */
export const Spin = defineBehavior({
  name: "Spin",
  defaults: { speed: 1, axis: [0, 1, 0] as Vec3 },
  frame: (object, { speed, axis }, { delta }) => stepSpin(object, speed, axis, delta),
});
