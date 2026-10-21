import { act } from "@testing-library/react";
import { createRef } from "react";
import { Text } from "react-native";
import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Group } from "../Group";
import { Label } from "../Label";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

const transformOf = (view: { getByText: (t: string) => HTMLElement }, text: string) =>
  (view.getByText(text).parentElement as HTMLElement).style;

describe("<Label>", () => {
  it("pins a view to a fixed point, above it, and moves when the camera moves", async () => {
    const view = await renderScene(
      <>
        {/* Labels show once the scene draws content. */}
        <Box />
        <Label position={[0, 0, 0]}>
          <Text>Station</Text>
        </Label>
      </>,
    );
    // The scene is ready on the first frame, and labels show from the next.
    await stepFrames(2);
    const style = transformOf(view, "Station");
    // The origin is at the centre of the 200 × 100 canvas.
    expect(style.transform).toContain("translateX(100px)");
    expect(style.opacity).toBe("1");
    view.scene.camera.position.x = 2;
    view.scene.camera.updateMatrixWorld();
    await act(async () => view.scene.invalidate());
    await stepFrames(1);
    expect(transformOf(view, "Station").transform).not.toContain("translateX(100px)");
  });

  it("follows an object, hides behind the camera, and waits for refs", async () => {
    const train = createRef<THREE.Group>();
    const view = await renderScene(
      <>
        <Box />
        <Group ref={train} />
        <Label attach={train} position={[0, 1, 0]} anchor="center">
          <Text>Your train</Text>
        </Label>
        <Label attach={{ current: null }} anchor="top">
          <Text>Nobody</Text>
        </Label>
      </>,
    );
    (train.current as THREE.Group).position.z = -2;
    await act(async () => view.scene.invalidate());
    await stepFrames(2);
    expect(transformOf(view, "Your train").opacity).toBe("1");
    expect(transformOf(view, "Nobody").opacity).toBe("0");
    (train.current as THREE.Group).position.z = 20; // behind the camera at z 6
    await act(async () => view.scene.invalidate());
    await stepFrames(2);
    expect(transformOf(view, "Your train").opacity).toBe("0");
  });

  it("takes an object directly", async () => {
    const pin = new THREE.Object3D();
    const view = await renderScene(
      <>
        <Box />
        <Label attach={pin}>
          <Text>Pin</Text>
        </Label>
      </>,
    );
    await stepFrames(2);
    expect(transformOf(view, "Pin").opacity).toBe("1");
  });

  it("stays hidden until the scene draws content, which <Scene onReady> reports", async () => {
    const onReady = vi.fn();
    const view = await renderScene(
      <Label position={[0, 0, 0]}>
        <Text>Early</Text>
      </Label>,
      { onReady },
    );
    await stepFrames(1);
    expect(transformOf(view, "Early").opacity).toBe("0");
    expect(onReady).not.toHaveBeenCalled();
    view.update(
      <>
        <Box />
        <Label position={[0, 0, 0]}>
          <Text>Early</Text>
        </Label>
      </>,
    );
    await stepFrames(3);
    expect(onReady).toHaveBeenCalledWith(view.scene);
    expect(transformOf(view, "Early").opacity).toBe("1");
  });

  it("is pinned in its parent's space inside a group", async () => {
    const view = await renderScene(
      <>
        <Box />
        <Label position={[0, 0, 0]}>
          <Text>Origin</Text>
        </Label>
        <Group position={[1, 0, 0]}>
          <Label position={[0, 0, 0]}>
            <Text>Station</Text>
          </Label>
        </Group>
      </>,
    );
    await stepFrames(2);
    const origin = transformOf(view, "Origin").transform;
    const station = transformOf(view, "Station").transform;
    expect(origin).toContain("translateX(100px)");
    // One unit to the right of the origin is further right on screen.
    const x = Number(/translateX\((-?[\d.]+)px\)/.exec(station)?.[1]);
    expect(x).toBeGreaterThan(110);
  });

  it("shows <Scene loading> until the scene draws content", async () => {
    const view = await renderScene(null, { loading: <Text>Loading…</Text> });
    await stepFrames(1);
    expect(view.queryByText("Loading…")).not.toBeNull();
    view.update(<Box />);
    await stepFrames(2);
    expect(view.queryByText("Loading…")).toBeNull();
  });
});
