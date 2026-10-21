import { createRef } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Instances } from "../Instances";
import { DirectionalLight } from "../lights";
import { Box, Plane } from "../shapes";
import { renderScene, stepFrames } from "./render";

const byName = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Mesh;

describe("shadows", () => {
  it("are off unless the scene asks, then everything decides by default, and props override", async () => {
    const plain = await renderScene(<Box name="box" />);
    expect(plain.scene.shadows).toBeNull();
    plain.unmount();

    const geometry = new THREE.BoxGeometry();
    const lamp = createRef<THREE.DirectionalLight>();
    const view = await renderScene(
      <>
        <Plane name="floor" size={10} rotation={[-Math.PI / 2, 0, 0]} />
        <Box name="box" />
        <Box name="ghost" castShadow={false} receiveShadow={false} />
        <Plane name="sign" castShadow />
        <Instances
          name="rows"
          geometry={geometry}
          items={[{}, { position: [2, 0, 0] }]}
          receiveShadow={false}
        />
        <DirectionalLight ref={lamp} intensity={0.1} castShadow />
      </>,
      { shadows: { radius: 20 } },
    );
    await stepFrames(2);
    const root = view.scene.scene;
    expect(view.scene.shadows).not.toBeNull();
    expect([byName(root, "floor").castShadow, byName(root, "floor").receiveShadow]).toEqual([false, true]);
    expect([byName(root, "box").castShadow, byName(root, "box").receiveShadow]).toEqual([true, true]);
    expect([byName(root, "ghost").castShadow, byName(root, "ghost").receiveShadow]).toEqual([false, false]);
    expect(byName(root, "sign").castShadow).toBe(true);
    const copies = (root.getObjectByName("rows") as THREE.Group).children[0] as THREE.InstancedMesh;
    expect([copies.castShadow, copies.receiveShadow]).toEqual([true, false]);
    // The dim light casts shadows because it asked to, instead of the look's brighter key light.
    expect(view.scene.shadows?.casting).toEqual([lamp.current]);
    // Removing the props makes it automatic again.
    view.update(
      <>
        <Box name="ghost" />
        <DirectionalLight ref={lamp} intensity={0.1} />
      </>,
    );
    await stepFrames(2);
    expect(byName(view.scene.scene, "ghost").castShadow).toBe(true);
    expect(view.scene.shadows?.casting).not.toContain(lamp.current);
  });
  it("can be all that shows of a shape: shadowOnly hides it from the camera, not from the light", async () => {
    const sun = createRef<THREE.DirectionalLight>();
    const view = await renderScene(
      <>
        <DirectionalLight ref={sun} />
        <Box name="roof" position={[0, 3, 0]} shadowOnly />
        <Box name="box" />
      </>,
      { shadows: true, look: "none" },
    );
    await stepFrames(1);
    const roof = byName(view.scene.scene, "roof");
    expect(roof.layers.test(view.scene.camera.layers)).toBe(false);
    expect(roof.castShadow).toBe(true);
    expect(roof.layers.test((sun.current as THREE.DirectionalLight).shadow.camera.layers)).toBe(true);
    view.update(
      <>
        <DirectionalLight ref={sun} />
        <Box name="roof" position={[0, 3, 0]} />
        <Box name="box" />
      </>,
    );
    await stepFrames(1);
    expect(roof.layers.test(view.scene.camera.layers)).toBe(true);
  });
});
