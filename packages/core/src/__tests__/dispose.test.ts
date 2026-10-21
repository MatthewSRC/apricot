import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { disposeObject } from "../dispose";

describe("disposeObject", () => {
  it("disposes geometries and materials of every mesh in the tree", () => {
    const root = new THREE.Group();
    const single = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
    root.add(single, new THREE.Group().add(multi), instanced);
    const spies = [
      vi.spyOn(single.geometry, "dispose"),
      vi.spyOn(single.material as THREE.Material, "dispose"),
      ...(multi.material as THREE.Material[]).map((m) => vi.spyOn(m, "dispose")),
      vi.spyOn(instanced, "dispose"),
    ];
    disposeObject(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});
