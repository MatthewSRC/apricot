import { StillGroup } from "@apricotjs/core";
import { createRef } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Bundle } from "../Bundle";
import type { SceneObject } from "../parent";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

describe("<Bundle>", () => {
  it("holds its children in a bundle the scene checks before each frame, until unmounted", async () => {
    const ref = createRef<SceneObject>();
    const view = await renderScene(
      <Bundle ref={ref} position={[1, 0, 0]}>
        <Box name="a" />
      </Bundle>,
    );
    await stepFrames(1);
    const group = ref.current as StillGroup;
    expect(group).toBeInstanceOf(StillGroup);
    expect(view.scene.bundles.has(group)).toBe(true);
    expect(group.position.x).toBe(1);
    expect((view.scene.scene.getObjectByName("a") as THREE.Mesh).parent).toBe(group);
    view.update(null);
    expect(view.scene.bundles.has(group)).toBe(false);
  });
});
