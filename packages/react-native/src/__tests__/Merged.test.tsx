import { shadowOf } from "@apricotjs/core";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Group } from "../Group";
import { LightBeam } from "../LightBeam";
import { Merged } from "../Merged";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

const merged = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o.name === "Merged") found.push(o as THREE.Mesh);
  });
  return found;
};

describe("<Merged>", () => {
  it("bakes a few at a time while its scene gets ready unseen (paused before it showed)", async () => {
    // Each bake takes 5 ms here, so an 8 ms frame budget fits two.
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 2.5));
    const view = await renderScene(
      [0, 1, 2, 3, 4].map((i) => (
        <Merged key={i}>
          <Box position={[i, 0, 0]} />
        </Merged>
      )),
      { paused: true },
    );
    const baked = () => merged(view.scene.scene).filter((m) => m.geometry.getAttribute("position")).length;
    await stepFrames(1);
    const first = baked();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(5);
    await stepFrames(4);
    expect(baked()).toBe(5);
    clock.mockRestore();
    view.unmount();
  });

  it("draws its plain shapes as one mesh with their colours, and leaves the rest as they are", async () => {
    const view = await renderScene(
      <Merged castShadow={false}>
        <Box name="a" position={[1, 0, 0]} color="#ff0000" />
        <Box name="b" position={[-1, 0, 0]} rotation={[0, 0.5, 0]} color="#0000ff" />
        <Box name="glass" material="glass" />
        <Box name="glow" material={{ preset: "light", color: "#ffeeaa" }} />
      </Merged>,
    );
    await stepFrames(1);
    const [mesh] = merged(view.scene.scene);
    const { geometry } = mesh;
    // Two boxes of 24 vertices each, coloured red and blue, in their original places.
    expect(geometry.getAttribute("position").count).toBe(48);
    const colors = geometry.getAttribute("color");
    expect([colors.getX(0), colors.getZ(0)]).toEqual([1, 0]);
    expect([colors.getX(47), colors.getZ(47)]).toEqual([0, 1]);
    expect(geometry.boundingBox?.max.x).toBeCloseTo(1.5);
    expect((mesh.material as THREE.MeshStandardNodeMaterial).vertexColors).toBe(true);
    expect(shadowOf(mesh).cast).toBe(false);
    // Baked shapes are hidden and drawn as part of the merged mesh. The others are drawn normally.
    const shown = (name: string) => view.scene.scene.getObjectByName(name)?.visible;
    expect(shown("a")).toBe(false);
    expect(shown("b")).toBe(false);
    expect(shown("glass")).toBe(true);
    expect(shown("glow")).toBe(true);
  });

  it("bakes again only when the shapes change, and shows ones taken out on their own", async () => {
    const shapes = (x: number, glass: boolean) => (
      <Merged roughness={0.4}>
        <Box name="a" position={[x, 0, 0]} />
        <Box name="b" material={glass ? "glass" : undefined} />
      </Merged>
    );
    const view = await renderScene(shapes(1, false));
    await stepFrames(1);
    const [mesh] = merged(view.scene.scene);
    const first = mesh.geometry;
    const dispose = vi.spyOn(first, "dispose");
    view.update(shapes(1, false));
    await stepFrames(1);
    expect(mesh.geometry).toBe(first);
    view.update(shapes(2, false));
    await stepFrames(1);
    expect(mesh.geometry).not.toBe(first);
    expect(dispose).toHaveBeenCalled();
    expect(mesh.geometry.boundingBox?.max.x).toBeCloseTo(2.5);
    view.update(shapes(2, true));
    await stepFrames(1);
    expect(mesh.geometry.getAttribute("position").count).toBe(24);
    expect(view.scene.scene.getObjectByName("b")?.visible).toBe(true);
    expect((mesh.material as THREE.MeshStandardNodeMaterial).roughness).toBe(0.4);
    // With nothing left to bake, the mesh is empty.
    view.update(<Merged />);
    await stepFrames(1);
    expect(mesh.geometry.getAttribute("position")).toBeUndefined();
    view.unmount();
  });

  it("leaves out shapes hidden by their own choice", async () => {
    const view = await renderScene(
      <Merged>
        <Box name="shown" />
        <Box name="hidden" visible={false} position={[5, 0, 0]} />
      </Merged>,
    );
    await stepFrames(1);
    const [mesh] = merged(view.scene.scene);
    expect(mesh.geometry.getAttribute("position").count).toBe(24);
    expect(mesh.geometry.boundingBox?.max.x).toBeCloseTo(0.5);
  });

  it("keeps baked shapes hidden when they render again, and follows their own `visible`", async () => {
    const shapes = (shown: boolean) => (
      <Merged>
        <Box name="a" />
        <Box name="b" visible={shown} position={[5, 0, 0]} />
      </Merged>
    );
    const view = await renderScene(shapes(true));
    await stepFrames(1);
    const [mesh] = merged(view.scene.scene);
    const a = view.scene.scene.getObjectByName("a") as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(48);
    // A re-render keeps them hidden. Shown for a frame, they would be drawn and compiled on their
    // own, and a <Bundle> would be recorded twice.
    view.update(shapes(true));
    expect(a.visible).toBe(false);
    // A shape hidden by its own `visible` is left out.
    view.update(shapes(false));
    await stepFrames(1);
    expect(mesh.geometry.getAttribute("position").count).toBe(24);
    const b = view.scene.scene.getObjectByName("b") as THREE.Mesh;
    expect(b.visible).toBe(false);
    view.update(shapes(true));
    await stepFrames(1);
    expect([mesh.geometry.getAttribute("position").count, b.visible]).toEqual([48, false]);
    // After unmount, the remaining shapes show as they would on their own.
    view.update(<Box name="a" />);
    await stepFrames(1);
    expect(view.scene.scene.getObjectByName("a")?.visible).toBe(true);
    view.unmount();
  });

  it("leaves a nested <Merged> to bake its own shapes", async () => {
    const view = await renderScene(
      <Merged>
        <Box name="outer" />
        <Group position={[3, 0, 0]}>
          <Merged>
            <Box name="inner" />
          </Merged>
        </Group>
      </Merged>,
    );
    await stepFrames(1);
    const meshes = merged(view.scene.scene);
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) expect(mesh.geometry.getAttribute("position").count).toBe(24);
  });
});

describe("<LightBeam>", () => {
  it("stretches from where light comes in to where it lands, with the opening's shape", async () => {
    const view = await renderScene(
      <LightBeam from={[2, 1.5, 0]} to={[0, 0, 1]} size={[1, 1.4]} facing={[-1, 0, 0]} intensity={2} />,
    );
    await stepFrames(1);
    const beam = view.scene.scene.getObjectByName("LightBeam") as THREE.Mesh;
    const start = new THREE.Vector3(0, 0, 0).applyMatrix4(beam.matrix);
    const end = new THREE.Vector3(0, 0, 1).applyMatrix4(beam.matrix);
    expect(start.toArray()).toEqual([2, 1.5, 0]);
    expect(end.x).toBeCloseTo(0);
    expect(end.z).toBeCloseTo(1);
    // The opening: 1 m along the wall (z), 1.4 m up.
    const across = new THREE.Vector3(0.5, 0, 0).applyMatrix4(beam.matrix).sub(start);
    expect(Math.abs(across.z)).toBeCloseTo(0.5);
    const up = new THREE.Vector3(0, 0.5, 0).applyMatrix4(beam.matrix).sub(start);
    expect(up.y).toBeCloseTo(0.7);
    // The beam casts no shadows and ignores taps.
    expect(shadowOf(beam)).toEqual({ cast: false, receive: false });
    const hits: THREE.Intersection[] = [];
    beam.raycast(new THREE.Raycaster(), hits);
    expect(hits).toEqual([]);
    const tint = (beam.material as THREE.MeshBasicNodeMaterial).colorNode as unknown as {
      value: THREE.Color;
    };
    view.update(<LightBeam from={[2, 1.5, 0]} to={[0, 0, 1]} size={[1, 1.4]} color="#00ff00" />);
    await stepFrames(1);
    expect(tint.value.getHexString()).toBe("00ff00");
    view.unmount();
  });

  it("faces level towards where it lands by default", async () => {
    const view = await renderScene(<LightBeam from={[0, 2, 0]} to={[0, 0, 2]} size={[1, 1]} />);
    await stepFrames(1);
    const beam = view.scene.scene.getObjectByName("LightBeam") as THREE.Mesh;
    const across = new THREE.Vector3(1, 0, 0).applyMatrix4(beam.matrix).sub(new THREE.Vector3(0, 2, 0));
    expect(Math.abs(across.x)).toBeCloseTo(1);
    // Straight down there is no level direction to face, so any upright orientation is accepted.
    const down = await renderScene(<LightBeam from={[0, 2, 0]} to={[0, 0, 0]} size={[1, 1]} />);
    await stepFrames(1);
    expect((down.scene.scene.getObjectByName("LightBeam") as THREE.Mesh).matrix.determinant()).not.toBe(0);
  });
});
