import type { FrameState } from "@apricotjs/core";
import { type ReactNode, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { type Animatable, useAnimatable } from "./animatable";
import { useFrame } from "./hooks";
import { ParentContext, useAttach } from "./parent";

export interface BehaviorDefinition<P extends Record<string, unknown>> {
  /** The component's display name, also used as the group's name. */
  name: string;
  /** Every prop with its default value. The keys are the behavior's props. */
  defaults: P;
  /**
   * Runs before each frame with the current prop values. `object` is a group
   * wrapping the behavior's children. Return true while still moving.
   */
  frame: (object: THREE.Object3D, props: Readonly<P>, state: FrameState) => boolean | undefined;
}

export type BehaviorProps<P> = { [K in keyof P]?: Animatable<P[K]> } & { children?: ReactNode };

/**
 * Creates a component that runs per-frame logic on a group wrapping its
 * children. Each key of `defaults` becomes a prop that accepts a plain or
 * shared value. The built-in behaviors use this API.
 *
 *   const Spin = defineBehavior({ name: "Spin", defaults: { speed: 1 }, frame: ... });
 *   <Spin speed={sharedValue}><Model /></Spin>
 */
export function defineBehavior<P extends Record<string, unknown>>(definition: BehaviorDefinition<P>) {
  const keys = Object.keys(definition.defaults) as (keyof P)[];

  function Behavior(props: BehaviorProps<P>) {
    const [group] = useState(() => {
      const g = new THREE.Group();
      g.name = definition.name;
      return g;
    });
    useAttach(group);
    // biome-ignore lint/correctness/useHookAtTopLevel: `keys` is fixed per behavior, so the hook order never changes
    const readers = keys.map((key) => [key, useAnimatable(props[key] ?? definition.defaults[key])] as const);
    const values = useRef({ ...definition.defaults });
    useFrame((state) => {
      for (const [key, read] of readers) values.current[key] = read() as P[keyof P];
      return definition.frame(group, values.current, state) === true;
    });
    return <ParentContext.Provider value={group}>{props.children}</ParentContext.Provider>;
  }

  Behavior.displayName = definition.name;
  return Behavior;
}
