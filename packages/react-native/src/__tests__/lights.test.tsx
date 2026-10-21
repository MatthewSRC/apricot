import { act } from "@testing-library/react";
import { createRef } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { AmbientLight, DirectionalLight, HemisphereLight, PointLight, SpotLight } from "../lights";
import { renderScene, stepFrames } from "./render";
import { sharedValue } from "./setup";

describe("lights", () => {
  it("adds lights with their colour, intensity, position and aim, and removes them", async () => {
    const sun = createRef<THREE.DirectionalLight>();
    const spot = createRef<THREE.SpotLight>();
    const bulb = createRef<THREE.PointLight>();
    const sky = createRef<THREE.HemisphereLight>();
    const ambient = createRef<THREE.AmbientLight>();
    const view = await renderScene(
      <>
        <AmbientLight ref={ambient} intensity={0.3} />
        <HemisphereLight ref={sky} sky="#ff0000" ground="#00ff00" />
        <DirectionalLight ref={sun} position={[1, 2, 3]} target={[0, 1, 0]} color="#ffeedd" intensity={2} />
        <PointLight ref={bulb} position={[0, 3, 0]} distance={10} />
        <SpotLight ref={spot} angle={0.3} penumbra={0.5} />
      </>,
      { look: "none" },
    );
    await stepFrames(1);
    expect(ambient.current?.intensity).toBe(0.3);
    expect(sky.current?.color.getHexString()).toBe("ff0000");
    expect(sky.current?.groundColor.getHexString()).toBe("00ff00");
    expect(sun.current?.position.toArray()).toEqual([1, 2, 3]);
    expect(sun.current?.target.position.toArray()).toEqual([0, 1, 0]);
    expect(sun.current?.color.getHexString()).toBe("ffeedd");
    expect(sun.current?.intensity).toBe(2);
    expect(bulb.current?.distance).toBe(10);
    expect(spot.current?.angle).toBe(0.3);
    expect(spot.current?.penumbra).toBe(0.5);
    expect(view.scene.scene.children).toContain(sun.current);
    view.update(null);
    expect(view.scene.scene.children.filter((c) => (c as THREE.Light).isLight)).toHaveLength(0);
  });

  it("dims and moves with shared values", async () => {
    const level = sharedValue(1);
    const where = sharedValue<[number, number, number]>([0, 1, 0]);
    const bulb = createRef<THREE.PointLight>();
    await renderScene(<PointLight ref={bulb} intensity={level as never} position={where as never} />);
    await act(async () => {
      level.value = 0.25;
      where.value = [2, 2, 2];
    });
    await stepFrames(1);
    expect(bulb.current?.intensity).toBe(0.25);
    expect(bulb.current?.position.toArray()).toEqual([2, 2, 2]);
  });
});
