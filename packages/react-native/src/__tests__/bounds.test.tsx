import { useState } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { NO_BOUNDS, type ObjectBounds, useBounds } from "../bounds";
import { CameraRig } from "../CameraRig";
import { Group } from "../Group";
import { useMaterialOverrides } from "../materials";
import type { SceneObject } from "../parent";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

describe("useBounds", () => {
  it("measures an object, again when something comes inside it later, leaving out what is marked", async () => {
    let seen: ObjectBounds | null = null;
    function Piece({ more }: { more: boolean }) {
      const [group, setGroup] = useState<SceneObject | null>(null);
      seen = useBounds(group);
      return (
        <Group ref={setGroup}>
          <Box size={[1, 2, 1]} position={[0, 1, 0]} />
          {more ? <Box size={1} position={[2, 0.5, 0]} /> : null}
          <Box size={10} name="shadow" />
        </Group>
      );
    }
    const view = await renderScene(<Piece more={false} />);
    // The marked object is left out.
    (view.scene.scene.getObjectByName("shadow") as THREE.Object3D).userData[NO_BOUNDS] = true;
    await stepFrames(2);
    const first = seen as ObjectBounds | null;
    expect(first?.size[0]).toBeCloseTo(1);
    expect(first?.size[1]).toBeCloseTo(2);
    expect(first?.center[1]).toBeCloseTo(1);
    // Adding an object inside, as a loading model does, measures again.
    view.update(<Piece more />);
    await stepFrames(2);
    const second = seen as ObjectBounds | null;
    expect(second?.min[0]).toBeCloseTo(-0.5);
    expect(second?.max[0]).toBeCloseTo(2.5);
    view.unmount();
  });
});

describe("useMaterialOverrides", () => {
  it("gives parts that come later the overrides too (a model inside loading)", async () => {
    const ghost = new THREE.MeshBasicNodeMaterial({ color: "#c8a2ff" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function Ghost({ later }: { later: boolean }) {
      const [group, setGroup] = useState<SceneObject | null>(null);
      useMaterialOverrides(group, { "*": ghost });
      return (
        <Group ref={setGroup}>
          <Box name="early" />
          {later ? <Box name="late" position={[1, 0, 0]} /> : null}
        </Group>
      );
    }
    const view = await renderScene(<Ghost later={false} />);
    await stepFrames(1);
    const material = (name: string) => (view.scene.scene.getObjectByName(name) as THREE.Mesh).material;
    expect(material("early")).toBe(ghost);
    view.update(<Ghost later />);
    await stepFrames(1);
    expect(material("late")).toBe(ghost);
    expect(material("early")).toBe(ghost);
    warn.mockRestore();
    view.unmount();
  });

  it("doesn't warn of no match while the object is still empty (a model loading)", async () => {
    const ghost = new THREE.MeshBasicNodeMaterial();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function Ghost({ loaded }: { loaded: boolean }) {
      const [group, setGroup] = useState<SceneObject | null>(null);
      useMaterialOverrides(group, { "*": ghost, door: ghost });
      return <Group ref={setGroup}>{loaded ? <Box name="chair" /> : null}</Group>;
    }
    const view = await renderScene(<Ghost loaded={false} />);
    await stepFrames(1);
    expect(warn).not.toHaveBeenCalled();
    view.update(<Ghost loaded />);
    await stepFrames(1);
    expect((view.scene.scene.getObjectByName("chair") as THREE.Mesh).material).toBe(ghost);
    // With meshes present and still no door, it warns once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[apricot] Material override "door" matches no part');
    warn.mockRestore();
    view.unmount();
  });
});

describe("<Group visible>", () => {
  it("hides what is in it, still warmed up with the scene, and shows it again", async () => {
    const view = await renderScene(
      <Group name="shelf" visible={false}>
        <Box />
      </Group>,
    );
    const shelf = view.scene.scene.getObjectByName("shelf") as THREE.Group;
    expect(shelf.visible).toBe(false);
    // Compiled while hidden, since the warm-up shows it to three for compiling.
    expect(shelf.userData["apricot:compileHidden"]).toBe(true);
    view.update(
      <Group name="shelf">
        <Box />
      </Group>,
    );
    expect(shelf.visible).toBe(true);
    view.unmount();
  });
});

describe("<CameraRig fit={{ footprint }}>", () => {
  it("fits the floor plan of the object given, leaving out what reaches past it", async () => {
    function World({ byFloor }: { byFloor: boolean }) {
      const [world, setWorld] = useState<SceneObject | null>(null);
      const [floor, setFloor] = useState<SceneObject | null>(null);
      return (
        <>
          <Group ref={setWorld}>
            <Group ref={setFloor}>
              <Box size={[4, 0.3, 4]} position={[0, 0.15, 0]} />
            </Group>
            {/* Fronds reaching past the edge. */}
            <Box size={[7, 0.1, 1]} position={[0, 2, 0]} />
          </Group>
          <CameraRig
            subject={world}
            view={{ azimuth: -30, elevation: 30, fov: 30 }}
            fit={byFloor ? { footprint: floor } : "footprint"}
          />
        </>
      );
    }
    const view = await renderScene(<World byFloor={false} />);
    await stepFrames(3);
    const camera = view.scene.camera;
    const byWhole = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    view.update(<World byFloor />);
    await stepFrames(3);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(byWhole * 0.85);
    view.unmount();
  });
});
