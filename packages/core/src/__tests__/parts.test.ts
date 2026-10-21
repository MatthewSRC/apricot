import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { assignMaterial, namePattern, selectParts, selectSlots, sourceMaterial } from "../parts";

const mat = (name: string) => {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = name;
  return m;
};
const mesh = (name: string, materials: THREE.Material | THREE.Material[]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(), materials);
  m.name = name;
  return m;
};

/** A car with Italian names, a multi-material body and a tagged door group. */
const car = () => {
  const root = new THREE.Group();
  root.name = "Auto";
  const paint = mat("Vernice_Carrozzeria.001");
  const glass = mat("vetro");
  const body = mesh("Carrozzeria", [paint, mat("Black_mat"), glass]);
  const door = new THREE.Group();
  door.name = "porta_ant_sx";
  door.userData.apricot = "door";
  door.add(mesh("porta_pannello", paint), mesh("porta_vetro", glass));
  const wheels = ["ruota_ant_sx", "ruota_ant_dx"].map((n) => mesh(n, mat("gomma")));
  root.add(body, door, ...wheels);
  return { root, body, door, wheels, paint, glass };
};

describe("namePattern", () => {
  it("matches * and ? case-insensitively and escapes everything else", () => {
    expect(namePattern("ruota_*").test("Ruota_ant_sx")).toBe(true);
    expect(namePattern("ruota_?nt*").test("ruota_ant_dx")).toBe(true);
    expect(namePattern("car_paint.001").test("car_paintX001")).toBe(false);
    expect(namePattern("a(b)").test("a(b)")).toBe(true);
    expect(namePattern("ruota_*")).toBe(namePattern("ruota_*")); // cached
  });
});

describe("selectSlots", () => {
  it("selects by part name, including everything under a part", () => {
    const { root, wheels, door } = car();
    expect(selectSlots(root, "ruota_*").map((s) => s.mesh)).toEqual(wheels);
    const doorSlots = selectSlots(root, "node:porta_ant_sx");
    expect(doorSlots.map((s) => s.mesh.name)).toEqual(["porta_pannello", "porta_vetro"]);
    expect(doorSlots.every((s) => door.children.includes(s.mesh))).toBe(true);
  });

  it("selects only the matching material slots of multi-material meshes", () => {
    const { root, body } = car();
    const slots = selectSlots(root, "material:Vernice*");
    expect(slots).toContainEqual({ mesh: body, index: 0 });
    expect(slots.some((s) => s.mesh === body && s.index !== 0)).toBe(false);
    expect(slots.map((s) => s.mesh.name)).toContain("porta_pannello");
  });

  it("matches plain names against parts and materials, tags, and lists", () => {
    const { root } = car();
    // "vetro*" is both a material ("vetro") and a part ("porta_vetro" is not: no prefix match).
    expect(selectSlots(root, "vetro*").map((s) => `${s.mesh.name}:${s.index}`)).toEqual([
      "Carrozzeria:2",
      "porta_vetro:0",
    ]);
    expect(selectSlots(root, "tag:door")).toHaveLength(2);
    expect(selectSlots(root, ["tag:door", "ruota_ant_dx"])).toHaveLength(3);
    expect(selectSlots(root, "nothing*")).toEqual([]);
    // The root's own name matches everything below it; names above the root do not count.
    expect(selectSlots(root, "Auto")).toHaveLength(7);
    const scene = new THREE.Scene();
    scene.name = "Scena";
    scene.add(root);
    expect(selectSlots(root, "Scena")).toEqual([]);
  });

  it("ignores unknown prefixes as part of the name, and unnamed materials", () => {
    const root = new THREE.Group();
    const odd = mesh("http:thing", new THREE.MeshStandardNodeMaterial());
    root.add(odd);
    expect(selectSlots(root, "http:thing")).toHaveLength(1);
    expect(selectSlots(root, "material:")).toHaveLength(1);
  });
});

describe("selectParts", () => {
  it("returns the outermost matching parts, by name, tag or material", () => {
    const { root, door, wheels, body } = car();
    expect(selectParts(root, "porta*")).toEqual([door]);
    expect(selectParts(root, "tag:door")).toEqual([door]);
    expect(selectParts(root, "node:ruota_*")).toEqual(wheels);
    expect(selectParts(root, "material:gomma")).toEqual(wheels);
    expect(selectParts(root, ["Carrozzeria", "ruota_ant_sx"])).toEqual([body, wheels[0]]);
    expect(selectParts(root, "Auto")).toEqual([]);
  });
});

describe("assignMaterial", () => {
  it("replaces single materials and single slots of material arrays", () => {
    const { root, body, wheels } = car();
    const chrome = mat("chrome");
    assignMaterial(selectSlots(root, "material:Black_mat"), chrome);
    const materials = body.material as THREE.Material[];
    expect(materials[1]).toBe(chrome);
    expect(materials[0].name).toBe("Vernice_Carrozzeria.001");
    assignMaterial(selectSlots(root, "ruota_ant_sx"), chrome);
    expect(wheels[0].material).toBe(chrome);
    expect(wheels[1].material).not.toBe(chrome);
  });

  it("keeps selecting slots by the material names in the file after replacing them", () => {
    const { root, body, door, paint } = car();
    const lacquer = mat("car-paint");
    assignMaterial(selectSlots(root, "material:Vernice*"), lacquer);
    expect((body.material as THREE.Material[])[0]).toBe(lacquer);
    // Still found by the original name, not by the new one.
    expect(selectSlots(root, "material:Vernice*")).toHaveLength(2);
    expect(selectSlots(root, "material:car-paint")).toHaveLength(0);
    expect(selectParts(door, "material:Vernice*").map((p) => p.name)).toEqual(["porta_pannello"]);
    expect(sourceMaterial(body, 0)).toBe(paint);
    // A second replacement keeps the first original.
    assignMaterial(selectSlots(root, "material:Vernice*"), mat("chrome"));
    expect(sourceMaterial(body, 0)).toBe(paint);
  });
});
