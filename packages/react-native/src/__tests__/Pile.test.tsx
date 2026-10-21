import { type ApricotScene, visibleBox } from "@apricotjs/core";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Group, Primitive } from "../Group";
import { Pile } from "../Pile";
import { fireLayout, renderScene, stepFrames } from "./render";

const ball = (radius = 0.3, withUserData = true) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius), new THREE.MeshStandardNodeMaterial());
  if (withUserData) mesh.userData.radius = radius;
  return mesh;
};

const pileOf = (scene: ApricotScene) => scene.scene.getObjectByName("Pile") as THREE.Group | undefined;
const instances = (scene: ApricotScene) => pileOf(scene)?.children[0] as THREE.InstancedMesh;

describe("<Pile>", () => {
  it("drops its children into a pile, reports settling once, and lets the loop sleep", async () => {
    const onSettled = vi.fn();
    const template = ball();
    const { scene } = await renderScene(
      <Pile count={6} duration={0.3} onSettled={onSettled}>
        <Primitive object={template} />
      </Pile>,
    );
    // The template itself is never drawn.
    expect(template.parent?.parent).toBeNull();
    expect(pileOf(scene)).toBeDefined();
    await stepFrames(200, 50);
    expect(instances(scene).count).toBe(6);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(scene.loop.isAwake).toBe(false);
    // The default area is what the camera sees, and everything comes to rest inside it.
    const { min, max } = visibleBox(scene.camera, 0.5);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      instances(scene).getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeGreaterThanOrEqual(min[0]);
      expect(p.x).toBeLessThanOrEqual(max[0]);
      expect(p.y).toBeGreaterThanOrEqual(min[1]);
    }
  });

  it("follows the screen when the scene resizes, without restarting", async () => {
    const { scene, container } = await renderScene(
      <Pile count={4} duration={0.1}>
        <Primitive object={ball()} />
      </Pile>,
    );
    await stepFrames(200, 50);
    const before = pileOf(scene);
    await fireLayout(container, 100, 400);
    expect(pileOf(scene)).toBe(before);
    expect(scene.loop.isAwake).toBe(true);
    await stepFrames(200, 50);
    const { min, max } = visibleBox(scene.camera, 0.5);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      instances(scene).getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeGreaterThanOrEqual(min[0] - 1e-6);
      expect(p.x).toBeLessThanOrEqual(max[0] + 1e-6);
    }
  });

  it("uses explicit bounds, moves them without restarting, and ignores resizes", async () => {
    const template = ball();
    const bounds = { min: [-1, -1, -0.3], max: [1, 1, 0.3] } as const;
    const view = await renderScene(
      <Pile count={3} duration={0.1} bounds={bounds}>
        <Primitive object={template} />
      </Pile>,
    );
    await stepFrames(100, 50);
    const first = pileOf(view.scene);
    view.update(
      <Pile count={3} duration={0.1} bounds={{ min: [-0.5, -2, -0.3], max: [0.5, 1, 0.3] }}>
        <Primitive object={template} />
      </Pile>,
    );
    expect(pileOf(view.scene)).toBe(first);
    await fireLayout(view.container, 120, 80);
    await stepFrames(200, 50);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      instances(view.scene).getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(0.5);
      expect(p.y).toBeGreaterThanOrEqual(-2);
      lowest = Math.min(lowest, p.y);
    }
    // Everything rests on the new, lower floor.
    expect(lowest).toBeLessThan(-1.5);
  });

  it("restarts for new options or children but not for equal inline values", async () => {
    const a = ball();
    const view = await renderScene(
      <Pile count={3} scale={[1, 1]} physics={{ friction: 0.5 }}>
        <Primitive object={a} />
      </Pile>,
    );
    const first = pileOf(view.scene);
    view.update(
      <Pile count={3} scale={[1, 1]} physics={{ friction: 0.5 }}>
        <Primitive object={a} />
      </Pile>,
    );
    expect(pileOf(view.scene)).toBe(first);
    view.update(
      <Pile count={4} scale={[1, 1]} physics={{ friction: 0.5 }}>
        <Primitive object={a} />
      </Pile>,
    );
    await stepFrames();
    const second = pileOf(view.scene);
    expect(second).not.toBe(first);
    expect(first?.parent).toBeNull();
    view.update(
      <Pile count={4} scale={[1, 1]} physics={{ friction: 0.5 }}>
        <Primitive object={ball(0.2, false)} />
      </Pile>,
    );
    await stepFrames();
    expect(pileOf(view.scene)).not.toBe(second);
    view.update(null);
    expect(pileOf(view.scene)).toBeUndefined();
  });

  it("measures meshes without a radius and skips children that are not meshes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = await renderScene(
      <Pile count={2}>
        <Group name="not-a-mesh" />
        <Primitive object={ball(0.4, false)} />
      </Pile>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not-a-mesh"));
    expect(pileOf(view.scene)?.children).toHaveLength(1);
    await stepFrames(150, 50);
    const sim = instances(view.scene);
    expect(sim.count).toBe(2);
    view.update(
      <Pile count={2}>
        <Group />
      </Pile>,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Group"));
    expect(pileOf(view.scene)).toBeUndefined();
    warn.mockRestore();
  });

  it("keeps the pile when its children report the same templates again", async () => {
    const template = ball(0.3, false);
    template.geometry.computeBoundingSphere();
    const { scene } = await renderScene(
      <Pile count={2} bounds={{ min: [-1, -1, -0.3], max: [1, 1, 0.3] }}>
        <Primitive object={template} />
      </Pile>,
    );
    const first = pileOf(scene);
    (template.parent as THREE.Object3D).dispatchEvent({ type: "childadded", child: template } as never);
    await stepFrames();
    expect(pileOf(scene)).toBe(first);
  });

  it("does nothing on frames before it has items", async () => {
    const { scene } = await renderScene(<Pile count={2}>{null}</Pile>);
    await stepFrames(3);
    expect(pileOf(scene)).toBeUndefined();
  });
});
