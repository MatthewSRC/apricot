import type { VehicleState } from "@apricotjs/core";
import { act } from "@testing-library/react";
import { createRef } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { FollowCamera } from "../FollowCamera";
import { Group, Primitive } from "../Group";
import { Vehicle } from "../Vehicle";
import { renderScene, stepFrames } from "./render";
import { sharedValue } from "./setup";

const toyCar = () => {
  const car = new THREE.Group();
  for (const name of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
    const wheel = new THREE.Object3D();
    wheel.name = name;
    car.add(wheel);
  }
  return car;
};

describe("<Group> and <Primitive> refs", () => {
  it("expose the three.js objects", async () => {
    const group = createRef<THREE.Group>();
    const primitive = createRef<THREE.Object3D>();
    const object = new THREE.Object3D();
    await renderScene(
      <Group ref={group} name="g">
        <Primitive ref={primitive} object={object} />
      </Group>,
    );
    expect(group.current?.name).toBe("g");
    expect(primitive.current).toBe(object);
  });
});

describe("<Vehicle>", () => {
  it("drives forward with throttle, spins and steers the wheels, then sleeps when stopped", async () => {
    const car = toyCar();
    const ref = createRef<THREE.Group>();
    const states: VehicleState[] = [];
    const throttle = sharedValue(0);
    const steer = sharedValue(0);
    const { scene } = await renderScene(
      <Vehicle
        ref={ref}
        throttle={throttle as never}
        steer={steer as never}
        onUpdate={(s) => states.push({ ...s })}
      >
        <Primitive object={car} />
      </Vehicle>,
    );
    await stepFrames(5);
    expect(ref.current?.position.z).toBe(0);
    await act(async () => {
      throttle.value = 1;
      steer.value = 1;
    });
    await stepFrames(60);
    const group = ref.current as THREE.Group;
    expect(group.position.z).toBeGreaterThan(1);
    expect(group.position.x).toBeLessThan(0); // steering right
    expect(group.rotation.y).toBeLessThan(0);
    const front = car.getObjectByName("wheel_fl") as THREE.Object3D;
    const rear = car.getObjectByName("wheel_rl") as THREE.Object3D;
    expect(front.rotation.x).toBeGreaterThan(1);
    expect(rear.rotation.x).toBeCloseTo(front.rotation.x);
    expect(front.rotation.y).toBeLessThan(0);
    expect(rear.rotation.y).toBe(0);
    expect(states.length).toBeGreaterThan(50);
    await act(async () => {
      throttle.value = 0;
      steer.value = 0;
    });
    await stepFrames(300);
    expect(scene.loop.isAwake).toBe(false);
    expect(states.at(-1)?.speed).toBe(0);
  });

  it("stands still with no input", async () => {
    const ref = createRef<THREE.Group>();
    const { scene } = await renderScene(<Vehicle ref={ref} />);
    await stepFrames(10);
    expect(ref.current?.position.toArray()).toEqual([0, 0, 0]);
    expect(scene.loop.isAwake).toBe(false);
  });

  it("starts where told, accepts plain inputs and options", async () => {
    const ref = createRef<THREE.Group>();
    await renderScene(
      <Vehicle ref={ref} start={{ x: 3, z: -2, heading: Math.PI }} throttle={0.5} maxSpeed={2} />,
    );
    await stepFrames(120);
    const group = ref.current as THREE.Group;
    expect(group.position.x).toBeCloseTo(3, 3);
    expect(group.position.z).toBeLessThan(-3); // facing -z
    expect(group.rotation.y).toBeCloseTo(Math.PI);
  });
});

describe("<FollowCamera>", () => {
  it("chases its target and does nothing without one", async () => {
    const target = createRef<THREE.Group>();
    const throttle = sharedValue(1);
    const { scene } = await renderScene(
      <>
        <Vehicle ref={target} throttle={throttle as never} />
        <FollowCamera target={target} distance={5} height={2} />
      </>,
    );
    await stepFrames(60);
    const car = (target.current as THREE.Group).position;
    expect(scene.camera.position.z).toBeLessThan(car.z);
    expect(scene.camera.position.y).toBeGreaterThan(1);
    const empty = createRef<THREE.Object3D>();
    const lonely = await renderScene(<FollowCamera target={empty} />);
    const before = lonely.scene.camera.position.clone();
    await stepFrames(3);
    expect(lonely.scene.camera.position.equals(before)).toBe(true);
    vi.restoreAllMocks();
  });
});
