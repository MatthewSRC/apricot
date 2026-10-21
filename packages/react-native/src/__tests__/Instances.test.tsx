import { act, render } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Instances, type InstancesHandle } from "../Instances";
import { Scene } from "../Scene";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

const instanced = (root: THREE.Object3D) => {
  const found: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) found.push(o as THREE.InstancedMesh);
  });
  return found;
};

const at = (mesh: THREE.InstancedMesh, i: number) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m).toArray();
};

describe("<Instances>", () => {
  it("draws many copies of a geometry with one mesh, and follows new items", async () => {
    const geometry = new THREE.BoxGeometry();
    const items = Array.from({ length: 50 }, (_, i) => ({ position: [i, 0, -20] as const }));
    const view = await renderScene(
      <Instances geometry={geometry} items={items} material="chrome" name="row" position={[0, 1, 0]} />,
    );
    const [mesh] = instanced(view.scene.scene);
    expect(mesh.count).toBe(50);
    expect(at(mesh, 49)).toEqual([49, 0, -20]);
    expect(mesh.material).toBeInstanceOf(THREE.Material);
    await stepFrames(1);
    expect(view.scene.scene.getObjectByName("row")?.position.y).toBe(1);
    // More copies grow the set and keep the material.
    const material = mesh.material;
    view.update(<Instances geometry={geometry} items={[...items, ...items]} material="chrome" />);
    const [grown] = instanced(view.scene.scene);
    expect(grown.count).toBe(100);
    expect(grown.material).toBe(material);
    view.update(<Instances geometry={geometry} items={items} material="chrome" visible={false} />);
    expect(instanced(view.scene.scene)[0].parent?.visible).toBe(false);
    // With nothing to copy, nothing is drawn.
    view.update(<Instances items={items} />);
    expect(instanced(view.scene.scene)).toHaveLength(0);
  });

  it("makes the material white when copies have their own colours, unless told a colour", async () => {
    const geometry = new THREE.BoxGeometry();
    const view = await renderScene(<Instances geometry={geometry} items={[{ color: "#ff0000" }, {}]} />);
    const [mesh] = instanced(view.scene.scene);
    expect((mesh.material as THREE.MeshStandardNodeMaterial).color.getHex()).toBe(0xffffff);
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect(c.getHex()).toBe(0xff0000);
    const own = new THREE.MeshBasicNodeMaterial({ color: "#123456" });
    view.update(<Instances geometry={geometry} items={[{ color: "#ff0000" }]} material={own} />);
    expect(instanced(view.scene.scene)[0].material).toBe(own);
  });

  it("copies every mesh of an object with its own materials, or one given material", async () => {
    const shape = new THREE.Group();
    const red = new THREE.MeshBasicNodeMaterial({ color: "red" });
    const leg = new THREE.Mesh(new THREE.BoxGeometry(), red);
    const top = new THREE.Mesh(new THREE.BoxGeometry(), red);
    top.position.y = 1;
    shape.add(leg, top);
    const items = [{ position: [0, 0, 0] as const }, { position: [5, 0, 0] as const }];
    const view = await renderScene(<Instances object={shape} items={items} />);
    const meshes = instanced(view.scene.scene);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.material === red)).toBe(true);
    expect(at(meshes[1], 1)).toEqual([5, 1, 0]);
    view.update(<Instances object={shape} items={items} material="gold" />);
    expect(instanced(view.scene.scene).every((m) => m.material !== red)).toBe(true);
    view.update(<Instances object={null} items={items} />);
    expect(instanced(view.scene.scene)).toHaveLength(0);
  });

  it("copies the shapes inside it, and follows changes to them", async () => {
    const items = [{ position: [0, 0, 0] as const }, { position: [5, 0, 0] as const }];
    const seat = (height: number, color?: string) => (
      <Instances items={items} color={color}>
        <Box size={[1, 0.2, 1]} position={[0, height, 0]} color="#ff0000" />
        <Box size={[1, 1, 0.2]} position={[0, 1, 0.4]} color="#ff0000" />
      </Instances>
    );
    const view = await renderScene(seat(0.5));
    await stepFrames(2);
    const meshes = instanced(view.scene.scene);
    // One instanced mesh per shape, placed within every copy. The shapes themselves are not drawn.
    expect(meshes).toHaveLength(2);
    expect(at(meshes[0], 1)).toEqual([5, 0.5, 0]);
    expect(at(meshes[1], 0)[2]).toBeCloseTo(0.4);
    const boxes: THREE.Mesh[] = [];
    view.scene.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh)
        boxes.push(o as THREE.Mesh);
    });
    expect(boxes).toHaveLength(0);
    // Shapes keep their own material unless a colour or material is given for all of them.
    expect((meshes[0].material as THREE.MeshStandardNodeMaterial).color.getHex()).toBe(0xff0000);
    // When a shape moves, the copies follow.
    view.update(seat(0.7));
    await stepFrames(2);
    expect(at(instanced(view.scene.scene)[0], 0)[1]).toBeCloseTo(0.7);
    const own = instanced(view.scene.scene)[0].material;
    view.update(seat(0.7, "#00ff00"));
    await stepFrames(2);
    // One material for every part, fading to the new colour.
    const [cushion, back] = instanced(view.scene.scene);
    expect(cushion.material).not.toBe(own);
    expect(back.material).toBe(cushion.material);
    // Removing a shape leaves one part.
    view.update(
      <Instances items={items}>
        <Box size={[1, 0.2, 1]} />
      </Instances>,
    );
    await stepFrames(2);
    expect(instanced(view.scene.scene)).toHaveLength(1);
  });

  it("tells which copy was tapped, with your own fields, and changes copies without a render", async () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const onPress = vi.fn();
    const ref = createRef<InstancesHandle>();
    const seats = [
      { position: [0, 0, 0] as const, seat: "A1" },
      { position: [0, 0, -50] as const, seat: "A2" },
    ];
    const view = await renderScene(
      <Instances geometry={geometry} items={seats} onPress={onPress} ref={ref} />,
    );
    view.scene.press(view.scene.size.width / 2, view.scene.size.height / 2);
    expect(onPress).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, item: expect.objectContaining({ seat: "A1" }) }),
    );
    // After moving the copy away by hand, the tap finds nothing.
    await act(async () => ref.current?.set(0, { position: [100, 0, 0] }));
    const [mesh] = instanced(view.scene.scene);
    expect(at(mesh, 0)).toEqual([100, 0, 0]);
    expect(ref.current?.group).toBe(mesh.parent);
    onPress.mockClear();
    view.scene.press(view.scene.size.width / 2, view.scene.size.height / 2);
    expect(onPress).not.toHaveBeenCalledWith(expect.objectContaining({ index: 0 }));
    view.update(<Instances geometry={geometry} items={seats} />);
    expect(view.scene.presses.active).toBe(false);
    view.unmount();
  });

  it("draws its copies under React StrictMode (effects run, are cleaned up and run again)", async () => {
    let root: THREE.Scene | null = null;
    render(
      <StrictMode>
        <Scene onCreated={(s) => (root = s.scene)}>
          <Instances
            geometry={new THREE.BoxGeometry()}
            items={[{ position: [0, 0, 0] }, { position: [2, 0, 0] }]}
          />
        </Scene>
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const meshes = instanced(root as unknown as THREE.Scene);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].count).toBe(2);
  });
});
