import { float, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  applyEnvironment,
  defineEnvironment,
  environmentNames,
  getEnvironment,
  STUDIO,
  StudioEnvironmentNode,
  StudioLight,
  studioRadiance,
} from "../environment";
import { ApricotScene } from "../scene";

type WithEnvironment = THREE.Scene & { environmentNode: THREE.Node | null };

describe("studio environment", () => {
  it("is set on the scene, configurable, and removable", () => {
    const scene = new THREE.Scene() as WithEnvironment;
    applyEnvironment(scene, "studio");
    expect(scene.environmentNode).toBeInstanceOf(StudioEnvironmentNode);
    applyEnvironment(scene, { intensity: 2, boxes: [] });
    expect((scene.environmentNode as unknown as StudioEnvironmentNode).options).toEqual({
      intensity: 2,
      boxes: [],
    });
    applyEnvironment(scene, "none");
    expect(scene.environmentNode).toBeNull();
    expect(StudioEnvironmentNode.type).toBe("StudioEnvironmentNode");
  });

  it("builds a radiance node from the lighting context, or from the normal without one", () => {
    const node = new StudioEnvironmentNode();
    const withContext = node.setup({
      context: { getUV: () => vec3(0, 0, 1), getTextureLevel: () => float(0.2) },
    } as unknown as THREE.NodeBuilder);
    expect((withContext as THREE.Node).isNode).toBe(true);
    const fallback = node.setup({ context: {} } as unknown as THREE.NodeBuilder);
    expect((fallback as THREE.Node).isNode).toBe(true);
  });

  it("has a default studio with a key light, side strips, a top light, a rim and a fill", () => {
    expect(STUDIO.boxes).toHaveLength(6);
    expect(Math.max(...STUDIO.boxes.map((b) => b.intensity))).toBeGreaterThan(1);
    // A box pointing straight up uses a different helper axis.
    const node = studioRadiance(vec3(0, 1, 0), float(0.5), {
      boxes: [{ direction: [0, 1, 0], size: [0.2, 0.2], intensity: 1 }],
    });
    expect((node as THREE.Node).isNode).toBe(true);
  });

  it("is on scenes that ask for it", () => {
    expect(
      (new ApricotScene({ environment: "studio" }).scene as WithEnvironment).environmentNode,
    ).toBeInstanceOf(StudioEnvironmentNode);
    expect(
      (new ApricotScene({ environment: "none" }).scene as WithEnvironment).environmentNode ?? null,
    ).toBeNull();
    expect((new ApricotScene().scene as WithEnvironment).environmentNode ?? null).toBeNull();
  });
});

describe("named environments", () => {
  it("has built-ins, takes new ones and applies them by name", () => {
    expect(environmentNames()).toEqual(expect.arrayContaining(["studio", "soft", "sunset", "night"]));
    expect(getEnvironment("studio")).toBe(STUDIO);
    const brand = { sky: ["#ffffff", "#888888", "#000000"] as const, boxes: [] };
    defineEnvironment("brand", brand);
    const scene = new THREE.Scene() as WithEnvironment;
    applyEnvironment(scene, "brand");
    expect((scene.environmentNode as unknown as StudioEnvironmentNode).options).toBe(brand);
  });

  it("names the known environments when given an unknown one", () => {
    expect(() => getEnvironment("beach")).toThrow(/Unknown environment "beach". Known: studio, soft.*none/);
  });
});

describe("StudioLight", () => {
  const one = {
    sky: ["#ffffff", "#808080", "#000000"] as const,
    boxes: [{ direction: [1, 0, 0] as const, size: [0.2, 0.1] as const, intensity: 4, color: "#ff0000" }],
    intensity: 2,
  };

  it("holds the studio as live values, with empty slots dark", () => {
    const light = new StudioLight(one);
    expect(light.slots).toBe(6);
    expect(light.boxes[0].forward.value.toArray()).toEqual([1, 0, 0]);
    expect(light.boxes[0].intensity.value).toBe(4);
    expect(light.boxes[0].color.value.getHexString()).toBe("ff0000");
    expect(light.boxes[1].intensity.value).toBe(0);
    expect(light.intensity.value).toBe(2);
    expect(light.sky[0].value.getHexString()).toBe("ffffff");
    // A box straight up still gets a usable frame.
    light.set({ boxes: [{ direction: [0, 1, 0], size: [0.2, 0.2], intensity: 1 }] });
    expect(light.boxes[0].right.value.length()).toBeCloseTo(1);
    expect(light.step(0.1)).toBe(false);
  });

  it("fades to another studio over time, ending exactly on it", () => {
    const light = new StudioLight(one);
    light.set(STUDIO, 1);
    expect(light.step(0.5)).toBe(true);
    const halfway = light.boxes[0].intensity.value;
    expect(halfway).toBeGreaterThan(Math.min(4, STUDIO.boxes[0].intensity));
    expect(halfway).toBeLessThan(Math.max(4, STUDIO.boxes[0].intensity) + 1e-9);
    expect(light.step(1)).toBe(false);
    expect(light.boxes[0].intensity.value).toBe(STUDIO.boxes[0].intensity);
    expect(light.intensity.value).toBe(1);
  });

  it("knows when a studio has more boxes than its slots", () => {
    const light = new StudioLight();
    const many = { boxes: Array.from({ length: 8 }, () => one.boxes[0]) };
    expect(light.fits(STUDIO)).toBe(true);
    expect(light.fits(many)).toBe(false);
    expect(new StudioLight(many).slots).toBe(8);
  });

  it("builds radiance from a shared light, with rotation and brightness as uniforms", () => {
    const light = new StudioLight();
    const node = studioRadiance(vec3(0, 0, 1), float(0.3), light);
    expect((node as THREE.Node).isNode).toBe(true);
    const env = new StudioEnvironmentNode(one);
    env.light.rotation.value = Math.PI;
    env.light.gain.value = 0.5;
    expect(env.light.boxes[0].intensity.value).toBe(4);
  });
});
