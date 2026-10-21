import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { beamEnd, beamStrength, createLightBeamGeometry, createLightBeamMaterial } from "../beam";
import type { Vec3 } from "../spin";

describe("light beams", () => {
  it("are see-through, add light, write no depth and show from inside", () => {
    const { material } = createLightBeamMaterial();
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.opacityNode).toBeTruthy();
  });

  it("change colour, brightness and reach without a new shader", () => {
    const beam = createLightBeamMaterial({ color: "#ff0000", intensity: 2, reach: 0.5 });
    const tint = beam.material.colorNode as unknown as { value: THREE.Color };
    expect(tint.value.getHexString()).toBe("ff0000");
    const version = beam.material.version;
    beam.set({ color: "#00ff00", intensity: 3, reach: 0.8 });
    beam.set({});
    expect(tint.value.getHexString()).toBe("00ff00");
    expect(beam.material.version).toBe(version);
  });

  it("stretch a box from z = 0 to z = 1", () => {
    const geometry = createLightBeamGeometry();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    expect(box.min.z).toBeCloseTo(0);
    expect(box.max.z).toBeCloseTo(1);
    expect(box.max.x - box.min.x).toBeCloseTo(1);
  });
});

describe("beamEnd and beamStrength", () => {
  it("find where light through an opening lands: the floor, or the first wall it meets", () => {
    // Through a window at x = 2, 1.5 m up, falling at 45° into the room (-x).
    expect(beamEnd([2, 1.5, 0], [-1, -1, 0])).toEqual([0.5, 0, 0]);
    expect(beamEnd([2, 1.5, 0], [-1, -1, 0], { floor: 0.5 })).toEqual([1, 0.5, 0]);
    // Low sun: the far wall (x = -2) comes first.
    const low = beamEnd([2, 1.5, 0], [-1, -0.2, 0], { bounds: [-2, -1.5, 2, 1.5] }) as Vec3;
    expect(low[0]).toBeCloseTo(-2);
    expect(low[1]).toBeCloseTo(0.7);
    // Slanting sideways, into the front wall (z = 1.5) first.
    const side = beamEnd([2, 1.5, 0], [-1, -0.3, 2], { bounds: [-2, -1.5, 2, 1.5] }) as Vec3;
    expect(side[2]).toBeCloseTo(1.5);
    expect(side[0]).toBeCloseTo(1.25);
    // Going up or level, or from below the floor: it never lands.
    expect(beamEnd([2, 1.5, 0], [-1, 0.2, 0])).toBeNull();
    expect(beamEnd([2, 1.5, 0], [-1, 0, 0])).toBeNull();
    expect(beamEnd([2, -1, 0], [-1, -1, 0])).toBeNull();
  });

  it("let light in head-on, less as it grazes, none from behind the wall", () => {
    expect(beamStrength([-1, 0, 0], [-1, -1, 0])).toBe(1);
    const grazing = beamStrength([-1, 0, 0], [-0.2, -1, 1]);
    expect(grazing).toBeGreaterThan(0);
    expect(grazing).toBeLessThan(1);
    expect(beamStrength([-1, 0, 0], [1, -1, 0])).toBe(0);
    expect(beamStrength([0, 0, 0], [1, -1, 0])).toBe(0);
  });
});
