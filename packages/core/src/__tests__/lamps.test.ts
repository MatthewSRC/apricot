import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { applyDynamicLighting, createLampGlowMaterial, LampPool, type LampSource } from "../lamps";

const lamp = (x: number, intensity = 2, level = 1): LampSource => {
  const object = new THREE.Object3D();
  object.position.set(x, 1, 0);
  return { object, color: new THREE.Color("#ffcc88"), intensity, distance: 3, level };
};

describe("LampPool", () => {
  it("is a fixed set of dark lights from the start, lit by the brightest lamps", () => {
    const scene = new THREE.Scene();
    const pool = new LampPool(scene, 2);
    expect(pool.lights).toHaveLength(2);
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight)).toHaveLength(2);
    pool.update();
    expect(pool.lights.map((l) => l.intensity)).toEqual([0, 0]);
    const dim = lamp(-1, 1);
    const bright = lamp(1, 4);
    const off = lamp(2, 9, 0);
    const room = new THREE.Group();
    room.position.x = 10;
    room.add(dim.object, bright.object);
    scene.add(room);
    pool.add(dim);
    const removeBright = pool.add(bright);
    pool.add(off);
    pool.update();
    // Both lamps that are on shine, where they are in the world; the one that's off doesn't.
    expect(pool.shining).toHaveLength(2);
    expect(pool.shining).not.toContain(off);
    const of = (source: LampSource) => pool.lights[pool.shining.indexOf(source)];
    expect(of(bright).position.x).toBeCloseTo(11);
    expect(of(bright).intensity).toBe(4);
    expect(of(bright).color.getHexString()).toBe("ffcc88");
    expect(of(bright).distance).toBe(3);
    // Dimming: the light follows the lamp's level, and stays on the same light.
    const light = of(dim);
    dim.level = 0.5;
    pool.update();
    expect(of(dim)).toBe(light);
    expect(light.intensity).toBe(0.5);
    // A third lamp brighter than one of them takes that one's light; the others keep theirs.
    const brightest = lamp(0, 10);
    room.add(brightest.object);
    pool.add(brightest);
    pool.update();
    expect(pool.shining).toContain(brightest);
    expect(pool.shining).not.toContain(dim);
    expect(of(brightest)).toBe(light);
    removeBright();
    pool.update();
    expect(pool.shining).toEqual(expect.arrayContaining([brightest, dim]));
    pool.dispose();
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight)).toHaveLength(0);
  });

  it("hides the lights not in use with dynamic lighting, keeping one in the shaders", () => {
    const scene = new THREE.Scene();
    const pool = new LampPool(scene, 4, true);
    pool.update();
    expect(pool.lights.map((l) => l.visible)).toEqual([true, false, false, false]);
    const a = lamp(0);
    const b = lamp(1);
    pool.add(a);
    pool.add(b);
    pool.update();
    expect(pool.lights.filter((l) => l.visible)).toHaveLength(2);
    a.level = 0;
    b.level = 0;
    pool.update();
    expect(pool.lights.filter((l) => l.visible)).toHaveLength(1);
    // Without it, all stay in the shaders (dark), so their number never changes.
    const fixed = new LampPool(new THREE.Scene(), 3);
    fixed.update();
    expect(fixed.lights.every((l) => l.visible)).toBe(true);
  });

  it("does nothing with no lights", () => {
    const pool = new LampPool(new THREE.Scene(), 0);
    pool.add(lamp(0));
    expect(() => pool.update()).not.toThrow();
    expect(pool.shining).toEqual([]);
  });
});

describe("createLampGlowMaterial", () => {
  it("adds light, writes no depth, and changes without a new shader", () => {
    const glow = createLampGlowMaterial({ color: "#ff0000", strength: 2 });
    const { material } = glow;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    const tint = material.colorNode as unknown as { value: THREE.Color };
    const opacity = material.opacityNode;
    glow.set({ color: "#00ff00", strength: 0 });
    expect(tint.value.getHexString()).toBe("00ff00");
    expect(material.opacityNode).toBe(opacity);
    glow.set({});
    expect(tint.value.getHexString()).toBe("00ff00");
    expect(createLampGlowMaterial().material.transparent).toBe(true);
  });
});

describe("applyDynamicLighting", () => {
  it("gives a WebGPU renderer dynamic lighting, with room for the point lights asked for", () => {
    const renderer = { isWebGPURenderer: true, lighting: null as unknown };
    expect(applyDynamicLighting(renderer, 24)).toBe(true);
    expect((renderer.lighting as { options: { maxPointLights: number } }).options.maxPointLights).toBe(24);
    expect(applyDynamicLighting({}, 24)).toBe(false);
    expect(applyDynamicLighting(null)).toBe(false);
  });
});
