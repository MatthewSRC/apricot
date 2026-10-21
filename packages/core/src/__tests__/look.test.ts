import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { applyLook, LOOKS, shadowBalance } from "../look";

describe("applyLook", () => {
  it.each(Object.keys(LOOKS) as (keyof typeof LOOKS)[])("adds the %s lights and background", (look) => {
    const scene = new THREE.Scene();
    applyLook(scene, look);
    const group = scene.getObjectByName("apricot:look");
    expect(group?.children.length).toBeGreaterThan(0);
    expect(group?.children.every((c) => (c as THREE.Light).isLight)).toBe(true);
    expect((scene.background as THREE.Color).getHexString()).toBe(
      new THREE.Color(LOOKS[look].background).getHexString(),
    );
  });

  it("replaces the previous look instead of stacking lights", () => {
    const scene = new THREE.Scene();
    applyLook(scene, "soft");
    applyLook(scene, "flat");
    expect(scene.children.filter((c) => c.name === "apricot:look")).toHaveLength(1);
    expect(scene.getObjectByName("apricot:look")?.children).toHaveLength(1);
  });

  it("can leave the background alone", () => {
    const scene = new THREE.Scene();
    applyLook(scene, "studio", { background: false });
    expect(scene.background).toBeNull();
  });

  it("returns a remover", () => {
    const scene = new THREE.Scene();
    const remove = applyLook(scene, "soft");
    remove();
    expect(scene.getObjectByName("apricot:look")).toBeUndefined();
  });

  it("leans the look on its key light when shadows are on, keeping the brightness", () => {
    const sum = (scene: THREE.Scene) => {
      let key = 0;
      let sky = 0;
      scene.traverse((o) => {
        if ((o as THREE.HemisphereLight).isHemisphereLight) sky += (o as THREE.Light).intensity;
        else if ((o as THREE.DirectionalLight).isDirectionalLight)
          key = Math.max(key, (o as THREE.Light).intensity);
      });
      return { key, sky };
    };
    for (const look of ["soft", "studio"] as const) {
      const plain = new THREE.Scene();
      applyLook(plain, look);
      const shadowed = new THREE.Scene();
      applyLook(shadowed, look, { shadows: true });
      const a = sum(plain);
      const b = sum(shadowed);
      expect(b.sky).toBeLessThan(a.sky);
      expect(b.key).toBeGreaterThan(a.key);
      expect(b.key + b.sky).toBeCloseTo(a.key + a.sky);
    }
    expect(shadowBalance(2, 2)).toEqual({ key: 2.9, sky: 1.1 });
    // Leaning less (the sun on the horizon): less moves; none at 0.
    expect(shadowBalance(0, 2, 0)).toEqual({ key: 0, sky: 2 });
    expect(shadowBalance(2, 2, 0.5).key).toBeCloseTo(2.45);
  });
});
