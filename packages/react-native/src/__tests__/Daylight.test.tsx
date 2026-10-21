import { daylightAt, type StudioEnvironmentNode, shadowBalance } from "@apricotjs/core";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Daylight } from "../Daylight";
import { renderScene, stepFrames } from "./render";

const lightsOf = (scene: THREE.Scene) => ({
  sun: scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight,
  fill: scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight,
});

describe("<Daylight>", () => {
  it("lights the scene for the time of day, animates changes, and restores the background", async () => {
    const view = await renderScene(<Daylight time={13} transition={0.5} />, {
      look: "none",
      background: "#123456",
      fog: true,
      environment: "studio",
    });
    await stepFrames(1);
    const { sun, fill } = lightsOf(view.scene.scene);
    const noon = daylightAt(13);
    expect(sun.intensity).toBeCloseTo(noon.sunIntensity);
    expect(fill.color.getHexString()).toBe(noon.sky.getHexString());
    expect((view.scene.scene.background as THREE.Color).getHexString()).toBe(noon.background.getHexString());
    expect((view.scene.scene.fog as THREE.Fog).color.getHexString()).toBe(noon.background.getHexString());
    view.update(<Daylight time={22} transition={0.5} />);
    await stepFrames(3, 16);
    expect(sun.intensity).toBeLessThan(noon.sunIntensity);
    expect(sun.intensity).toBeGreaterThan(daylightAt(22).sunIntensity);
    await stepFrames(60, 16);
    expect(sun.intensity).toBeCloseTo(daylightAt(22).sunIntensity);
    const env = (view.scene.scene as unknown as { environmentNode: StudioEnvironmentNode }).environmentNode;
    expect(env.light.gain.value).toBeCloseTo(daylightAt(22).reflections);
    view.update(null);
    expect((view.scene.scene.background as THREE.Color).getHexString()).toBe("123456");
  });

  it("can leave the background alone, and creates one where there was none", async () => {
    const view = await renderScene(<Daylight time={9} background={false} />, { look: "none" });
    await stepFrames(1);
    expect(view.scene.scene.background).toBeNull();
    view.update(<Daylight time={9} />);
    await stepFrames(1);
    expect(view.scene.scene.background).toBeInstanceOf(THREE.Color);
  });

  it("paints no sky behind a see-through scene", async () => {
    const { scene } = await renderScene(<Daylight time={22} />, { transparent: true });
    await stepFrames(1);
    expect(scene.scene.background).toBeNull();
  });

  it("leans on the sun in a scene with shadows, so they read", async () => {
    const view = await renderScene(<Daylight time={13} transition={0} />, {
      look: "none",
      environment: "studio",
      shadows: true,
    });
    await stepFrames(1);
    const { sun, fill } = lightsOf(view.scene.scene);
    const noon = daylightAt(13);
    const balanced = shadowBalance(noon.sunIntensity, noon.fillIntensity);
    expect(sun.intensity).toBeCloseTo(balanced.key * 1.3);
    expect(fill.intensity).toBeCloseTo(balanced.sky);
    const env = (view.scene.scene as unknown as { environmentNode: StudioEnvironmentNode }).environmentNode;
    expect(env.light.gain.value).toBeCloseTo(noon.reflections * 0.5);
    expect(view.scene.shadows?.casting).toEqual([sun]);
  });
});
