import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { createMarker } from "../marker";

describe("createMarker", () => {
  it("is a soft see-through patch whose size, colour and shape change without a new shader", () => {
    const marker = createMarker({ size: [2, 1], color: "#ff0000", radius: 0.2 });
    const { mesh } = marker;
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect([mesh.scale.x, mesh.scale.y]).toEqual([2, 1]);
    expect(marker.get()).toEqual({ size: [2, 1], color: "#ff0000", opacity: 0.8, radius: 0.2, outline: 0 });
    const shader = mesh.material.opacityNode;
    const version = mesh.material.version;
    marker.set({ size: [0.5, 3], color: "#00ff00", opacity: 0.4, radius: 1, outline: 0.05 });
    expect([mesh.scale.x, mesh.scale.y]).toEqual([0.5, 3]);
    expect(marker.get()).toEqual({
      size: [0.5, 3],
      color: "#00ff00",
      opacity: 0.4,
      radius: 1,
      outline: 0.05,
    });
    // Only uniforms changed.
    expect(mesh.material.opacityNode).toBe(shader);
    expect(mesh.material.version).toBe(version);
    // Nothing given: nothing changes.
    marker.set({});
    expect(marker.get().color).toBe("#00ff00");
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    const material = vi.spyOn(mesh.material, "dispose");
    marker.dispose();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(createMarker().get().color).toBe(`#${new THREE.Color("#4f8cff").getHexString()}`);
  });
});
