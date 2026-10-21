import { ArcadeVehicle, type VehicleOptions, type VehicleState } from "@apricotjs/core";
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { type Animatable, useAnimatable } from "./animatable";
import { useFrame } from "./hooks";
import { ParentContext, type SceneObject, useAttach } from "./parent";

export interface VehicleProps extends VehicleOptions {
  /** From -1 (reverse or brake) to 1 (full throttle). Accepts a shared value. */
  throttle?: Animatable<number>;
  /** From -1 (left) to 1 (right). Accepts a shared value. */
  steer?: Animatable<number>;
  /** Start position and heading (radians; 0 faces +z). */
  start?: { x?: number; z?: number; heading?: number };
  /** The group that moves, for example as a <FollowCamera> target. */
  ref?: Ref<SceneObject>;
  /** Called on the JS thread after each simulated frame. */
  onUpdate?: (state: Readonly<VehicleState>) => void;
  /** The car to drive. Descendants named `wheel_f…` steer and spin; `wheel_r…` spin. */
  children?: ReactNode;
}

/**
 * Drives its children like a toy car on the ground plane. It turns throttle
 * and steering into position, heading and wheel motion (see ArcadeVehicle).
 * The scene keeps rendering only while the car moves. Options are read once,
 * at mount.
 */
export function Vehicle({ throttle, steer, start, ref, onUpdate, children, ...options }: VehicleProps) {
  const [group] = useState(() => {
    const g = new THREE.Group();
    g.name = "Vehicle";
    return g;
  });
  const [sim] = useState(() => new ArcadeVehicle(options, start));
  useImperativeHandle(ref, () => group, [group]);
  useAttach(group);
  const readThrottle = useAnimatable(throttle);
  const readSteer = useAnimatable(steer);
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const wheels = useRef<THREE.Object3D[]>([]);

  useFrame(({ delta }) => {
    const input = { throttle: readThrottle() ?? 0, steer: readSteer() ?? 0 };
    const moving = sim.step(delta, input);
    const state = sim.state;
    group.position.set(state.x, 0, state.z);
    group.rotation.y = state.heading;
    wheels.current.length = 0;
    group.traverse((object) => {
      if (object.name.startsWith("wheel_")) wheels.current.push(object);
    });
    for (const wheel of wheels.current) {
      wheel.rotation.x = state.wheelSpin;
      if (wheel.name.startsWith("wheel_f")) wheel.rotation.y = -state.steer;
    }
    update.current?.(state);
    return moving || input.throttle !== 0 || input.steer !== 0;
  });

  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}
