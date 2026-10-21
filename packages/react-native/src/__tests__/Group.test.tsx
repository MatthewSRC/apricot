import { act } from "@testing-library/react";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Group, Primitive } from "../Group";
import { applyTransform } from "../transform";
import { renderScene, stepFrames } from "./render";
import { sharedValue } from "./setup";

describe("applyTransform", () => {
  it("sets position, rotation and uniform or per-axis scale", () => {
    const o = new THREE.Object3D();
    applyTransform(o, { position: [1, 2, 3], rotation: [0, Math.PI, 0], scale: 2 });
    expect(o.position.toArray()).toEqual([1, 2, 3]);
    expect(o.rotation.y).toBeCloseTo(Math.PI);
    expect(o.scale.toArray()).toEqual([2, 2, 2]);
    applyTransform(o, { scale: [1, 2, 3] });
    expect(o.scale.toArray()).toEqual([1, 2, 3]);
  });

  it("leaves unset values alone", () => {
    const o = new THREE.Object3D();
    o.position.set(4, 5, 6);
    applyTransform(o, {});
    expect(o.position.toArray()).toEqual([4, 5, 6]);
  });
});

describe("<Group>", () => {
  it("adds a named group to the scene and nests children", async () => {
    const view = await renderScene(
      <Group name="outer" position={[0, 1, 0]}>
        <Group name="inner" scale={2} />
      </Group>,
    );
    const outer = view.scene.scene.getObjectByName("outer");
    expect(outer?.parent).toBe(view.scene.scene);
    expect(outer?.getObjectByName("inner")?.parent).toBe(outer);
    await stepFrames();
    expect(outer?.position.y).toBe(1);
    expect(outer?.getObjectByName("inner")?.scale.x).toBe(2);
    view.unmount();
    expect(outer?.parent).toBeNull();
  });

  it("defaults to an empty name", async () => {
    const view = await renderScene(<Group />);
    const group = view.scene.scene.children.find((c) => c instanceof THREE.Group && c.name === "");
    expect(group).toBeDefined();
  });

  it("follows shared values", async () => {
    const rotation = sharedValue<[number, number, number]>([0, 0, 0]);
    const view = await renderScene(<Group name="g" rotation={rotation as never} />);
    await act(async () => {
      rotation.value = [0, 1, 0];
    });
    await stepFrames();
    expect(view.scene.scene.getObjectByName("g")?.rotation.y).toBe(1);
  });
});

describe("<Primitive>", () => {
  it("adds an existing object and parents children under it", async () => {
    const mesh = new THREE.Mesh();
    mesh.name = "mesh";
    const view = await renderScene(
      <Primitive object={mesh} position={[2, 0, 0]}>
        <Group name="child" />
      </Primitive>,
    );
    expect(mesh.parent).toBe(view.scene.scene);
    expect(mesh.getObjectByName("child")).toBeDefined();
    await stepFrames();
    expect(mesh.position.x).toBe(2);
  });
});
