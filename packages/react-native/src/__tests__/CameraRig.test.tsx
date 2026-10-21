import { setShadow } from "@apricotjs/core";
import { act } from "@testing-library/react";
import { createRef } from "react";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CameraRig, type CameraRigHandle } from "../CameraRig";
import { Primitive } from "../Group";
import { fireLayout, renderScene, stepFrames } from "./render";

const box = () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4));
  mesh.position.set(5, 0.5, 0);
  return mesh;
};

describe("<CameraRig>", () => {
  it("frames its parent, flies to new views and takes commands", async () => {
    const car = box();
    const ref = createRef<CameraRigHandle>();
    const view = await renderScene(
      <Primitive object={car}>
        <CameraRig view="front" ref={ref} />
      </Primitive>,
    );
    const camera = view.scene.camera;
    // In front of the box (+z), looking at its centre.
    expect(camera.position.x).toBeCloseTo(5, 4);
    expect(camera.position.z).toBeGreaterThan(2);
    view.update(
      <Primitive object={car}>
        <CameraRig view="top" ref={ref} transition={0.5} />
      </Primitive>,
    );
    await stepFrames(3, 16);
    const midway = camera.position.y;
    await stepFrames(40, 16);
    expect(camera.position.y).toBeGreaterThan(midway);
    expect(Math.hypot(camera.position.x - 5, camera.position.z)).toBeLessThan(0.05);
    await act(async () => ref.current?.jumpTo({ azimuth: 90, elevation: 0, distance: 3 }));
    expect(camera.position.x).toBeCloseTo(8, 4);
    await act(async () => ref.current?.flyTo("back"));
    await stepFrames(80, 16);
    expect(camera.position.z).toBeLessThan(-2);
    // Described views, compared by value.
    view.update(
      <Primitive object={car}>
        <CameraRig view={{ azimuth: -90, elevation: 0, distance: 2 }} transition={0} />
      </Primitive>,
    );
    await stepFrames(2);
    expect(camera.position.x).toBeCloseTo(3, 4);
  });

  it("flies to frame something else given to it, or cuts with transition 0", async () => {
    const sofa = box();
    const mug = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
    mug.position.set(-3, 0.05, 0);
    const view = await renderScene(
      <>
        <Primitive object={sofa} />
        <Primitive object={mug} />
        <CameraRig view="front" subject={sofa} transition={0.5} />
      </>,
    );
    const camera = view.scene.camera;
    const far = camera.position.distanceTo(new THREE.Vector3(5, 0.5, 0));
    view.update(
      <>
        <Primitive object={sofa} />
        <Primitive object={mug} />
        <CameraRig view="front" subject={mug} transition={0.5} />
      </>,
    );
    await stepFrames(2, 16);
    // Still flying, so not there yet.
    expect(camera.position.x).toBeGreaterThan(-2.9);
    await stepFrames(60, 16);
    expect(camera.position.x).toBeCloseTo(-3, 3);
    expect(camera.position.distanceTo(mug.position)).toBeLessThan(far / 4);
    view.update(
      <>
        <Primitive object={sofa} />
        <Primitive object={mug} />
        <CameraRig view="front" subject={sofa} transition={0} />
      </>,
    );
    await stepFrames(1);
    expect(camera.position.x).toBeCloseTo(5, 3);
  });

  it("sways round the view, and fits a floor plan at one distance from every side", async () => {
    const car = box();
    const rig = (props: Partial<Parameters<typeof CameraRig>[0]>) => (
      <Primitive object={car}>
        <CameraRig view={{ azimuth: 0, elevation: 30 }} {...props} />
      </Primitive>
    );
    const view = await renderScene(rig({ sway: { degrees: 20, period: 2 } }));
    const camera = view.scene.camera;
    const azimuth = () => Math.atan2(camera.position.x - 5, camera.position.z) * (180 / Math.PI);
    const seen: number[] = [];
    // Eases into the swing over 1.5 s, then swings twice.
    await stepFrames(30, 50);
    for (let i = 0; i < 80; i++) {
      await stepFrames(1, 50);
      seen.push(azimuth());
    }
    // Both ways round the front, about 20° each way.
    expect(Math.min(...seen)).toBeLessThan(-15);
    expect(Math.max(...seen)).toBeGreaterThan(15);
    // A fitted floor plan keeps the same distance from the side.
    view.update(rig({ fit: "footprint", keepDistance: true, view: { azimuth: 10, elevation: 30 } }));
    await stepFrames(80, 16);
    const front = camera.position.distanceTo(new THREE.Vector3(5, 0, 0));
    view.update(rig({ fit: "footprint", keepDistance: true, view: { azimuth: 90, elevation: 30 } }));
    await stepFrames(80, 16);
    expect(camera.position.distanceTo(new THREE.Vector3(5, 0, 0))).toBeCloseTo(front, 3);
    view.unmount();
  });

  it("frames around UI insets, follows resizes and cleans up the view offset", async () => {
    const view = await renderScene(<CameraRig subject={box()} inset={{ bottom: 50 }} />);
    expect(view.scene.camera.view?.enabled).toBe(true);
    await fireLayout(view.container, 400, 400);
    expect(view.scene.camera.view?.fullHeight).toBe(400);
    view.update(null);
    expect(view.scene.camera.view?.enabled ?? false).toBe(false);
  });

  it("frames only what the camera sees, not what only casts a shadow", async () => {
    const frame = async (withRoof: boolean) => {
      const room = new THREE.Group();
      room.add(box());
      if (withRoof) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30));
        roof.position.y = 6;
        setShadow(roof, { only: true });
        room.add(roof);
      }
      const view = await renderScene(<CameraRig subject={room} view="front" />);
      const at = view.scene.camera.position.clone();
      view.unmount();
      return at;
    };
    const plain = await frame(false);
    const roofed = await frame(true);
    expect(roofed.distanceTo(plain)).toBeLessThan(1e-6);
  });

  it("frames nothing at the scene root unless given a subject", async () => {
    const view = await renderScene(<CameraRig view={{ azimuth: 0, elevation: 0 }} />);
    expect(view.scene.camera.position.z).toBeCloseTo(6, 4);
    view.update(<CameraRig view={{ azimuth: 0, elevation: 0 }} subject={null} views={{ hero: {} }} />);
    expect(view.scene.camera.position.z).toBeCloseTo(6, 4);
  });

  it("follows a moving object, drifting around it", async () => {
    const train = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10));
    const view = await renderScene(
      <>
        <Primitive object={train} />
        <CameraRig
          follow={train}
          view={{ azimuth: 90, elevation: 0, distance: 20 }}
          followStiffness={50}
          drift={10}
        />
      </>,
    );
    await stepFrames(2);
    train.position.z = 40;
    await act(async () => view.scene.invalidate());
    await stepFrames(30, 16);
    expect(view.scene.camera.position.z).toBeGreaterThan(30);
    view.update(<Primitive object={train} />);
  });

  it("follows a ref, framing what it points at", async () => {
    const ref = { current: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)) };
    const view = await renderScene(<CameraRig follow={ref} view="front" />);
    await stepFrames(1);
    expect(view.scene.camera.position.z).toBeGreaterThan(0);
  });
});
