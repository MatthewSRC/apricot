import { BLUR_LAYER } from "@apricotjs/core";
import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Blur } from "../Blur";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";
import { rendererState } from "./setup";

describe("<Blur>", () => {
  it("draws its children softly behind the rest, and takes them away on unmount", async () => {
    const view = await renderScene(
      <>
        <Blur radius={5}>
          <Box name="far" />
        </Blur>
        <Box name="near" />
      </>,
    );
    const root = view.scene.scene;
    const group = root.getObjectByName("Blur") as THREE.Group;
    const backdrop = root.getObjectByName("Blur backdrop") as THREE.Mesh;
    const far = root.getObjectByName("far") as THREE.Mesh;
    expect(far.parent).toBe(group);
    const before = rendererState.targetRenders;
    await stepFrames(3);
    // Only on the blur layer: drawn into the small target (the group and two passes) and shown behind.
    expect(far.layers.mask).toBe(1 << BLUR_LAYER);
    expect((root.getObjectByName("near") as THREE.Mesh).layers.mask).toBe(1);
    expect(rendererState.targetRenders - before).toBeGreaterThanOrEqual(3);
    expect(backdrop.visible).toBe(true);

    view.update(
      <Blur radius={9}>
        <Box name="far" />
      </Blur>,
    );
    await stepFrames(1);
    view.update(null);
    expect(root.getObjectByName("Blur")).toBeUndefined();
    expect(root.getObjectByName("Blur backdrop")).toBeUndefined();
  });
});
