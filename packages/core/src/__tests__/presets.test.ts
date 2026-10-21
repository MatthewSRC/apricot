import { float, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createMaterial, definePreset, getPreset, PresetMaterial, presetNames } from "../presets";

/** The kinds of nodes in a graph, depth first: enough to tell two graphs apart. */
const nodeShape = (node: unknown, seen = new Set<unknown>()): unknown => {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  const children = Object.values(node as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value && typeof value === "object" && (value as { isNode?: boolean }).isNode)
    .map((child) => nodeShape(child, seen));
  return [(node as { constructor: { name: string } }).constructor.name, children];
};

describe("material presets", () => {
  it("ships the built-in looks", () => {
    expect(presetNames()).toEqual(
      expect.arrayContaining([
        "car-paint",
        "paint",
        "gloss-black",
        "chrome",
        "brushed-metal",
        "aluminium",
        "gold",
        "rose-gold",
        "glass",
        "tinted-glass",
        "rubber",
        "plastic",
        "matte",
        "clay",
        "light",
      ]),
    );
    expect(() => getPreset("unobtainium")).toThrow(
      /Unknown material preset "unobtainium". Known: standard, car-paint/,
    );
  });

  it("builds physical materials with each preset's features", () => {
    const paint = createMaterial("car-paint") as THREE.MeshPhysicalNodeMaterial;
    expect(paint).toBeInstanceOf(THREE.MeshPhysicalNodeMaterial);
    expect(paint.clearcoat).toBe(1);
    expect(paint.name).toBe("car-paint");
    expect((createMaterial("brushed-metal") as THREE.MeshPhysicalNodeMaterial).anisotropy).toBeGreaterThan(0);
    const tinted = createMaterial("tinted-glass") as THREE.MeshPhysicalNodeMaterial;
    expect(tinted.transmission).toBe(1);
    expect(tinted.attenuationDistance).toBeLessThan(1);
    expect(tinted.attenuationColor.getHexString()).toBe(new THREE.Color("#20262c").getHexString());
    const glass = createMaterial("glass") as THREE.MeshPhysicalNodeMaterial;
    expect(glass.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
    const light = createMaterial("light", { color: "#ff0000" }) as THREE.MeshPhysicalNodeMaterial;
    expect(light.emissiveIntensity).toBe(2);
    // Lights glow in their own colour; fixed glow colours still work.
    expect(light.emissiveNode).toBeTruthy();
    definePreset("test-neon", { color: "#000000", roughness: 1, metalness: 0, emissive: "#00ffcc" });
    const neon = createMaterial("test-neon") as THREE.MeshPhysicalNodeMaterial;
    expect(neon.emissive.getHexString()).toBe("00ffcc");
    expect(neon.emissiveIntensity).toBe(1);
    expect(neon.emissiveNode).toBeNull();
    expect((createMaterial("chrome") as THREE.MeshPhysicalNodeMaterial).clearcoat).toBe(0);
  });

  it("takes options, images, engraving and raw physical properties", () => {
    const art = new THREE.Texture();
    const handle = new PresetMaterial("glass", {
      color: "#00ff00",
      roughness: 0.2,
      metalness: 0.1,
      map: new THREE.Texture(),
      engrave: { mask: art, color: "#ffffff", uv: vec2(0, 0), weight: float(1) },
      physical: { thickness: 0.4 },
    });
    expect(handle.values.color.getHexString()).toBe("00ff00");
    expect(handle.values.roughness).toBe(0.2);
    expect(handle.material.thickness).toBe(0.4);
    expect(handle.material.transmissionNode).not.toBeNull();
    // Defaults for the engraving come from the preset.
    const plain = new PresetMaterial("gold", { engrave: { mask: art } });
    expect(plain.material.colorNode).not.toBeNull();
  });

  it("shows both sides or the back, and multiplies in the shape's own colours, when asked", () => {
    const plain = new PresetMaterial("matte").material;
    expect(plain.side).toBe(THREE.FrontSide);
    expect(plain.vertexColors).toBe(false);
    expect(new PresetMaterial("matte", { side: "double" }).material.side).toBe(THREE.DoubleSide);
    expect(new PresetMaterial("matte", { side: "back" }).material.side).toBe(THREE.BackSide);
    expect(new PresetMaterial("matte", { vertexColors: true }).material.vertexColors).toBe(true);
  });

  it("keeps an image's alpha (cut-outs, fades) and divides premultiplied colour back out", () => {
    const art = new THREE.Texture();
    const straight = new PresetMaterial("paint", { map: art, physical: { alphaTest: 0.5 } }).material;
    // Colour and the image's alpha joined into one vec4 (three applies alphaTest to that alpha).
    const shapeOf = (node: unknown) => JSON.stringify(nodeShape(node));
    expect(shapeOf(straight.colorNode)).toContain("JoinNode");
    expect(straight.alphaTest).toBe(0.5);
    // Without an image the colour stays a plain colour.
    expect(shapeOf(new PresetMaterial("paint").material.colorNode)).not.toContain("JoinNode");
    // Premultiplied images: a different colour graph (the division), sRGB or not.
    art.premultiplyAlpha = true;
    art.colorSpace = THREE.SRGBColorSpace;
    const premultiplied = new PresetMaterial("paint", { map: art }).material.colorNode;
    const data = new THREE.Texture();
    data.premultiplyAlpha = true;
    data.colorSpace = THREE.NoColorSpace;
    const linear = new PresetMaterial("paint", { map: data }).material.colorNode;
    expect(shapeOf(premultiplied)).not.toBe(shapeOf(straight.colorNode));
    expect(shapeOf(linear)).not.toBe(shapeOf(premultiplied));
  });

  it("changes live values instantly or smoothly, without new materials", () => {
    const handle = new PresetMaterial("car-paint", { color: "#000000" });
    const material = handle.material;
    handle.set({ color: "#ffffff", roughness: 0.5, metalness: 0.2 });
    expect(handle.values).toMatchObject({ roughness: 0.5, metalness: 0.2 });
    handle.animateTo({ color: "#000000", roughness: 0.1 }, 1);
    expect(handle.step(0.5)).toBe(true);
    const mid = handle.values;
    expect(mid.color.r).toBeGreaterThan(0.1);
    expect(mid.color.r).toBeLessThan(0.9);
    expect(mid.roughness).toBeCloseTo(0.3);
    expect(handle.step(0.6)).toBe(false);
    expect(handle.values.color.getHex()).toBe(0);
    expect(handle.values.roughness).toBeCloseTo(0.1);
    expect(handle.step(0.1)).toBe(false);
    // Same values: nothing to animate. Zero duration: instant.
    handle.animateTo({ roughness: 0.1 });
    expect(handle.step(0.01)).toBe(false);
    handle.animateTo({ metalness: 1 }, 0);
    expect(handle.values.metalness).toBe(1);
    // set() cancels a running animation.
    handle.animateTo({ roughness: 0.9 }, 1);
    handle.set({});
    expect(handle.step(0.5)).toBe(false);
    expect(handle.material).toBe(material);
    handle.dispose();
  });

  it("registers custom presets", () => {
    definePreset("carbon-fibre", { color: "#151515", roughness: 0.35, metalness: 0.1, clearcoat: 1 });
    expect(presetNames()).toContain("carbon-fibre");
    expect((createMaterial("carbon-fibre") as THREE.MeshPhysicalNodeMaterial).clearcoat).toBe(1);
  });
});
