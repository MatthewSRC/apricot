import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  createBackdrop,
  createContactShadow,
  createGround,
  createPineTreeGeometry,
  createRoundTreeGeometry,
  createTrees,
} from "../scenery";

describe("trees", () => {
  it("builds round and pine trees standing on y = 0", () => {
    for (const geometry of [createRoundTreeGeometry(), createPineTreeGeometry()]) {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox as THREE.Box3;
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeGreaterThan(2);
      expect(geometry.getAttribute("color")).toBeDefined();
    }
  });

  it("scatters a forest in two draw calls, outside the clearing and inside the area", () => {
    const forest = createTrees({ count: 200, area: [-20, -10, 20, 10], clearing: 5, seed: 2 });
    const meshes = forest.children as THREE.InstancedMesh[];
    expect(meshes.map((m) => m.name)).toEqual(["Trees:round", "Trees:pine"]);
    expect(meshes[0].count + meshes[1].count).toBe(200);
    expect(meshes[0].material).toBe(meshes[1].material);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(5);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(20);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(10);
        expect(p.y).toBe(0);
      }
      expect(mesh.boundingSphere).not.toBeNull();
    }
  });

  it("is reproducible, works with defaults and gives up on areas inside the clearing", () => {
    const positions = (seed: number) =>
      Array.from((createTrees({ seed, count: 10 }).children[0] as THREE.InstancedMesh).instanceMatrix.array);
    expect(positions(4)).toEqual(positions(4));
    expect(positions(4)).not.toEqual(positions(5));
    const tiny = createTrees({ count: 3, area: [-1, -1, 1, 1], clearing: 10 });
    const total = (tiny.children as THREE.InstancedMesh[]).reduce((n, mesh) => n + mesh.count, 0);
    expect(total).toBe(3);
    expect((createTrees({ count: 0 }).children[0] as THREE.InstancedMesh).count).toBe(0);
  });
});

describe("createGround", () => {
  it("is a flat square at y = 0 with a shader colour", () => {
    const ground = createGround({ size: 50 });
    ground.geometry.computeBoundingBox();
    const box = ground.geometry.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(50);
    expect(box.max.y - box.min.y).toBeCloseTo(0);
    expect((ground.material as THREE.MeshStandardNodeMaterial).colorNode).not.toBeNull();
    expect(createGround().name).toBe("Ground");
  });
});

describe("createContactShadow", () => {
  it("is a transparent, flat, soft ellipse just above the ground", () => {
    const shadow = createContactShadow({ width: 2, length: 3, opacity: 0.5 });
    const material = shadow.material as THREE.MeshBasicNodeMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacityNode).not.toBeNull();
    expect(shadow.position.y).toBeGreaterThan(0);
    shadow.geometry.computeBoundingBox();
    const box = shadow.geometry.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(2);
    expect(box.max.z - box.min.z).toBeCloseTo(3);
    expect(createContactShadow().name).toBe("ContactShadow");
  });
});

describe("createBackdrop", () => {
  it("is an unlit plane facing +z with a shader colour, with or without lines", () => {
    const backdrop = createBackdrop({ size: [10, 6] });
    expect(backdrop.name).toBe("Backdrop");
    expect(backdrop.material).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
    backdrop.geometry.computeBoundingBox();
    const box = backdrop.geometry.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(10);
    expect(box.max.y - box.min.y).toBeCloseTo(6);
    expect(backdrop.geometry.getAttribute("normal").getZ(0)).toBeCloseTo(1);
    const plain = createBackdrop({ lines: false });
    expect((plain.material as THREE.MeshBasicNodeMaterial).colorNode).not.toBeNull();
  });
});
