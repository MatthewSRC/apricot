import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { InstanceSet, instanceParts } from "../instances";
import { PressRouter } from "../press";

const box = () => ({
  geometry: new THREE.BoxGeometry(1, 1, 1),
  material: new THREE.MeshStandardNodeMaterial(),
  offset: new THREE.Matrix4(),
});

const positionOf = (mesh: THREE.InstancedMesh, i: number) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
};

describe("InstanceSet", () => {
  it("places, turns and sizes each copy, drawing only as many as there are", () => {
    const set = new InstanceSet([box()]);
    set.setItems([
      { position: [1, 2, 3] },
      { position: [-1, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 2 },
      { scale: [1, 3, 1] },
    ]);
    const [mesh] = set.instancedMeshes;
    expect(set.size).toBe(3);
    expect(mesh.count).toBe(3);
    expect(positionOf(mesh, 0).toArray()).toEqual([1, 2, 3]);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(1, m);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(2);
    mesh.getMatrixAt(2, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.toArray().map((v) => Math.round(v))).toEqual([1, 3, 1]);
    // Fewer copies: drawn count shrinks; none: hidden.
    set.setItems([{}]);
    expect(mesh.count).toBe(1);
    set.setItems([]);
    expect(mesh.visible).toBe(false);
    expect(set.group.children).toContain(mesh);
  });

  it("grows past its capacity, keeping what it had", () => {
    const set = new InstanceSet([box()], 2);
    set.setItems([{ position: [5, 0, 0], color: "#ff0000" }]);
    const items = Array.from({ length: 40 }, (_, i) => ({ position: [i, 0, 0] as const }));
    set.setItems(items);
    const [mesh] = set.instancedMeshes;
    expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(40);
    expect(set.group.children).toEqual([mesh]);
    expect(positionOf(mesh, 39).x).toBe(39);
    // Colours carried over; copies without a colour are white (the material's own).
    expect(mesh.instanceColor).not.toBeNull();
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff);
  });

  it("colours copies (others stay white), hides copies, and changes one at a time", () => {
    const set = new InstanceSet([box()]);
    set.setItems([{}, { color: "#00ff00" }, { visible: false }]);
    const [mesh] = set.instancedMeshes;
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xffffff);
    mesh.getColorAt(1, c);
    expect(c.getHex()).toBe(0x00ff00);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(2, m);
    expect(m.determinant()).toBe(0);
    const version = mesh.instanceMatrix.version;
    set.set(0, { position: [0, 9, 0], color: "#0000ff" });
    expect(positionOf(mesh, 0).y).toBe(9);
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0x0000ff);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(version);
    expect(mesh.boundingSphere).toBeNull();
    expect(() => set.set(3, {})).toThrow(RangeError);
    // No colours at all: no colour buffer.
    const plain = new InstanceSet([box()]);
    plain.setItems([{}, {}]);
    expect(plain.instancedMeshes[0].instanceColor).toBeNull();
  });

  it("copies every mesh of an object together, each in its place", () => {
    const shape = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry());
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5));
    top.position.set(0, 1, 0);
    const rigged = new THREE.SkinnedMesh(new THREE.BoxGeometry());
    shape.add(body, top, rigged);
    shape.position.set(100, 0, 0); // the object's own placement does not matter
    const parts = instanceParts(shape);
    expect(parts).toHaveLength(2);
    const set = new InstanceSet(parts);
    set.setItems([{ position: [0, 0, 5], scale: 2 }]);
    const [a, b] = set.instancedMeshes;
    expect(positionOf(a, 0).toArray()).toEqual([0, 0, 5]);
    expect(positionOf(b, 0).toArray()).toEqual([0, 2, 5]);
    expect(b.geometry).toBe(top.geometry);
    // Disposing frees the copies' buffers but keeps the meshes, to be shown again if need be.
    const freed = vi.fn();
    a.addEventListener("dispose", freed);
    set.dispose();
    expect(freed).toHaveBeenCalled();
    expect(set.group.children).toHaveLength(2);
  });

  it("tells which copy a tap hit", () => {
    const set = new InstanceSet([box()]);
    set.setItems([
      { position: [-3, 0, 0] },
      { position: [3, 0, 0] },
      { position: [0, 0, 0], visible: false },
    ]);
    const scene = new THREE.Scene().add(set.group);
    scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const router = new PressRouter();
    let hit: ReturnType<PressRouter["hitTest"]> = null;
    router.add(set.group, (h) => {
      hit = h;
    });
    // Right of centre: the copy at +3.
    const x = 100 + (3 / (10 * Math.tan((25 * Math.PI) / 180))) * 100;
    router.press(camera, x, 100, 200, 200);
    expect(hit).not.toBeNull();
    expect(set.indexOf(hit as never)).toBe(1);
    // The hidden copy in the middle is not hit.
    expect(router.press(camera, 100, 100, 200, 200)).toBeNull();
    expect(set.indexOf({ mesh: new THREE.Mesh(), instanceId: 0 })).toBeNull();
    expect(set.indexOf({ mesh: set.instancedMeshes[0] })).toBeNull();
    expect(set.indexOf({ mesh: set.instancedMeshes[0], instanceId: 7 })).toBeNull();
  });
});
