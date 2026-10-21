import { createRef } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Box, Capsule, Cone, Cylinder, Mesh, Plane, Sphere, Torus } from "../shapes";
import { sharedGeometryCount } from "../sharedGeometry";
import { renderScene, stepFrames } from "./render";

const meshes = (scene: THREE.Scene) => scene.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];

describe("shapes", () => {
  it("share one geometry between shapes of a kind and size, freed when the last one goes", async () => {
    const before = sharedGeometryCount();
    const boxes = (n: number, size = 1) => (
      <>
        {Array.from({ length: n }, (_, i) => `box${i}`).map((name) => (
          <Box key={name} name={name} size={size} />
        ))}
        <Sphere name="ball" radius={1} />
      </>
    );
    const view = await renderScene(boxes(3));
    const geometryOf = (name: string) => (view.scene.scene.getObjectByName(name) as THREE.Mesh).geometry;
    expect(geometryOf("box0")).toBe(geometryOf("box2"));
    expect(geometryOf("box0")).not.toBe(geometryOf("ball"));
    expect(sharedGeometryCount()).toBe(before + 2);
    const shared = geometryOf("box0");
    const dispose = vi.spyOn(shared, "dispose");
    // Unmounting one box keeps the geometry for the others.
    view.update(boxes(2));
    expect(dispose).not.toHaveBeenCalled();
    // A new size gets its own geometry, and the old one is freed with its last box.
    view.update(boxes(2, 2));
    expect(geometryOf("box0")).not.toBe(shared);
    expect(dispose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(sharedGeometryCount()).toBe(before);
  });

  it("adds each shape with a default material, and removes and frees it on unmount", async () => {
    const view = await renderScene(
      <>
        <Box name="box" />
        <Sphere name="sphere" />
        <Cylinder name="cylinder" radiusTop={0.2} />
        <Cone name="cone" />
        <Plane name="plane" size={[2, 1]} />
        <Torus name="torus" />
        <Capsule name="capsule" />
      </>,
    );
    const added = meshes(view.scene.scene);
    expect(added.map((m) => m.name)).toEqual([
      "box",
      "sphere",
      "cylinder",
      "cone",
      "plane",
      "torus",
      "capsule",
    ]);
    for (const m of added) expect((m.material as THREE.Material).name).toBe("standard");
    const geometry = added[0].geometry;
    const dispose = vi.spyOn(geometry, "dispose");
    view.update(null);
    expect(meshes(view.scene.scene)).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });

  it("sizes boxes, rounds them, and rebuilds the geometry when the size changes", async () => {
    const ref = createRef<THREE.Mesh>();
    const view = await renderScene(<Box ref={ref} size={[2, 1, 0.5]} />);
    const box = ref.current as THREE.Mesh;
    box.geometry.computeBoundingBox();
    expect(box.geometry.boundingBox?.getSize(new THREE.Vector3()).toArray()).toEqual([2, 1, 0.5]);
    const first = box.geometry;
    view.update(<Box ref={ref} size={1} radius={0.2} />);
    expect(box.geometry).not.toBe(first);
    expect(box.geometry.type).toBe("RoundedBoxGeometry");
  });

  it("takes presets, colours and three.js materials, and animates colour changes", async () => {
    const ref = createRef<THREE.Mesh>();
    const view = await renderScene(<Sphere ref={ref} material="chrome" />);
    const sphere = ref.current as THREE.Mesh;
    expect((sphere.material as THREE.MeshPhysicalNodeMaterial).metalness).toBe(1);
    view.update(<Sphere ref={ref} material={{ preset: "gold", roughness: 0.5 }} />);
    expect((sphere.material as THREE.MeshPhysicalNodeMaterial).roughness).toBe(0.5);
    view.update(<Sphere ref={ref} color="#ff0000" />);
    const standard = sphere.material as THREE.MeshPhysicalNodeMaterial;
    expect(standard.color.getHexString()).toBe("ff0000");
    view.update(<Sphere ref={ref} color="#0000ff" />);
    await stepFrames(60, 16);
    const blue = sphere.material as THREE.MeshPhysicalNodeMaterial;
    expect(blue).not.toBe(standard);
    expect(blue.color.getHexString()).toBe("0000ff");
    const mine = new THREE.MeshBasicNodeMaterial();
    view.update(<Sphere ref={ref} material={mine} visible={false} position={[1, 2, 3]} />);
    await stepFrames(1);
    expect(sphere.material).toBe(mine);
    expect(sphere.visible).toBe(false);
    expect(sphere.position.toArray()).toEqual([1, 2, 3]);
  });

  it("calls onPress for taps, and nests children", async () => {
    const onPress = vi.fn();
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const view = await renderScene(
      <Mesh geometry={geometry} onPress={onPress}>
        <Box name="child" position={[0, 2, 0]} />
      </Mesh>,
    );
    const [mesh] = meshes(view.scene.scene);
    expect(mesh.getObjectByName("child")).toBeDefined();
    view.scene.press(view.scene.size.width / 2, view.scene.size.height / 2);
    expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ mesh }));
    view.update(<Mesh geometry={geometry} />);
    expect(view.scene.presses.active).toBe(false);
  });
  it("places shapes with plain values at once, and only again when they change", async () => {
    const view = await renderScene(<Box name="b" position={[1, 2, 3]} rotation={[0, 1, 0]} scale={2} />);
    const box = view.scene.scene.getObjectByName("b") as THREE.Mesh;
    // Before any frame.
    expect(box.position.toArray()).toEqual([1, 2, 3]);
    expect(box.scale.x).toBe(2);
    // Frames do not rewrite plain values, so a move made in code stays.
    box.position.x = 9;
    await stepFrames(2);
    expect(box.position.x).toBe(9);
    view.update(<Box name="b" position={[4, 2, 3]} rotation={[0, 1, 0]} scale={[1, 2, 3]} />);
    expect(box.position.x).toBe(4);
    expect(box.scale.z).toBe(3);
  });
});
