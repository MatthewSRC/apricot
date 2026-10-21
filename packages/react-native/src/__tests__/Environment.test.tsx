import { getEnvironment, StudioEnvironmentNode } from "@apricotjs/core";
import { act } from "@testing-library/react";
import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Environment } from "../Environment";
import { renderScene, stepFrames } from "./render";
import { sharedValue } from "./setup";

type WithEnvironment = THREE.Scene & { environmentNode: THREE.Node | null };
const nodeOf = (scene: THREE.Scene) =>
  (scene as WithEnvironment).environmentNode as unknown as StudioEnvironmentNode;

describe("<Environment>", () => {
  it("fades the scene's environment to a named one, and back on unmount", async () => {
    const view = await renderScene(<Environment name="sunset" transition={0.2} />, { environment: "studio" });
    const node = nodeOf(view.scene.scene);
    const sunsetKey = getEnvironment("sunset").boxes?.[0].intensity as number;
    // It reuses the scene's node and fades instead of rebuilding.
    expect(node).toBeInstanceOf(StudioEnvironmentNode);
    await stepFrames(30, 16);
    expect(node.light.boxes[0].intensity.value).toBe(sunsetKey);
    view.update(null);
    expect(nodeOf(view.scene.scene)).toBe(node);
    expect(node.light.boxes[0].intensity.value).toBe(getEnvironment("studio").boxes?.[0].intensity);
  });

  it("creates its own environment where the scene has none, and takes a described one", async () => {
    const view = await renderScene(
      <Environment
        sky={["#ffffff", "#888888", "#000000"]}
        boxes={[{ direction: [0, 1, 0], size: [0.3, 0.3], intensity: 3 }]}
      />,
    );
    const node = nodeOf(view.scene.scene);
    expect(node.light.boxes[0].intensity.value).toBe(3);
    expect(node.light.sky[0].value.getHexString()).toBe("ffffff");
    // Changing the boxes fades on the same node.
    view.update(
      <Environment boxes={[{ direction: [1, 0, 0], size: [0.3, 0.3], intensity: 5 }]} transition={0} />,
    );
    await stepFrames(2);
    expect(nodeOf(view.scene.scene)).toBe(node);
    expect(node.light.boxes[0].intensity.value).toBe(5);
    // With only a sky, the studio's default boxes are used.
    view.update(<Environment sky={["#000000", "#000000", "#000000"]} transition={0} />);
    await stepFrames(2);
    expect(node.light.sky[0].value.getHexString()).toBe("000000");
    expect(node.light.boxes[0].intensity.value).toBe(getEnvironment("studio").boxes?.[0].intensity);
    view.update(null);
    expect((view.scene.scene as WithEnvironment).environmentNode ?? null).toBeNull();
  });

  it("rebuilds only when the boxes outgrow their slots", async () => {
    const box = { direction: [0, 1, 0] as const, size: [0.2, 0.2] as const, intensity: 1 };
    const view = await renderScene(<Environment boxes={[box]} />);
    const first = nodeOf(view.scene.scene);
    view.update(<Environment boxes={Array.from({ length: 8 }, () => box)} />);
    await stepFrames(1);
    const second = nodeOf(view.scene.scene);
    expect(second).not.toBe(first);
    expect(second.light.slots).toBe(8);
  });

  it("turns and dims with plain or shared values", async () => {
    const angle = sharedValue(0);
    const view = await renderScene(<Environment name="studio" rotation={angle as never} intensity={0.5} />);
    const node = nodeOf(view.scene.scene);
    await stepFrames(1);
    expect(node.light.gain.value).toBe(0.5);
    await act(async () => {
      angle.value = 1.2;
    });
    await stepFrames(1);
    expect(node.light.rotation.value).toBe(1.2);
  });
});
