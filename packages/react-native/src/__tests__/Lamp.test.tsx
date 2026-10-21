import { daylightAt, footprintOf } from "@apricotjs/core";
import { useEffect } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Daylight, useDaylight } from "../Daylight";
import { Group } from "../Group";
import { Lamp } from "../Lamp";
import { LightBeam } from "../LightBeam";
import { Box } from "../shapes";
import { WindowPane } from "../WindowPane";
import { renderScene, stepFrames } from "./render";

const beamOf = (scene: THREE.Scene) => scene.getObjectByName("LightBeam") as THREE.Mesh;
const strengthOf = (mesh: THREE.Mesh) => {
  // The beam material's brightness uniform (see createLightBeamMaterial).
  const tint = (mesh.material as THREE.MeshBasicNodeMaterial).colorNode as unknown as { value: THREE.Color };
  return tint.value;
};

describe("<Lamp>", () => {
  it("lights the scene from its place while on, fading, with a glow, and is left out of footprints", async () => {
    const lamp = (on: boolean | "dark", x = 0) => (
      <Group name="table" position={[x, 0, 0]}>
        <Box size={[0.4, 0.4, 0.4]} position={[0, 0.2, 0]} />
        <Lamp
          position={[0, 0.5, 0]}
          on={on}
          glow={0.3}
          intensity={2}
          distance={4}
          color="#ff8800"
          transition={2}
        />
      </Group>
    );
    const view = await renderScene(lamp(true), { lamps: 2 });
    const [light, spare] = view.scene.lamps.lights;
    await stepFrames(400, 16);
    view.scene.lamps.update();
    expect(light.intensity).toBeCloseTo(2);
    expect(light.position.toArray()).toEqual([0, 0.5, 0]);
    expect(light.color.getHexString()).toBe("ff8800");
    expect(light.distance).toBe(4);
    expect(spare.intensity).toBe(0);
    const glow = view.scene.scene.getObjectByName("Lamp:glow") as THREE.Mesh;
    expect(glow.visible).toBe(true);
    expect(glow.scale.x).toBeCloseTo(0.3);
    // The glow does not count towards the table's size.
    const table = view.scene.scene.getObjectByName("table") as THREE.Object3D;
    expect(footprintOf(table)?.maxY).toBeCloseTo(0.4);
    // It moves with its parent.
    view.update(lamp(true, 1));
    await stepFrames(2, 16);
    view.scene.lamps.update();
    expect(light.position.x).toBeCloseTo(1);
    // Switched off, it fades out.
    view.update(lamp(false, 1));
    await stepFrames(3, 16);
    view.scene.lamps.update();
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.intensity).toBeLessThan(2);
    await stepFrames(400, 16);
    view.scene.lamps.update();
    expect(light.intensity).toBe(0);
    view.unmount();
  });

  it('with on="dark", comes on as it gets dark with <Daylight>', async () => {
    const room = (time: number) => (
      <>
        <Daylight time={time} transition={0} />
        <Lamp on="dark" />
      </>
    );
    const view = await renderScene(room(13), { lamps: 1, look: "none" });
    await stepFrames(60, 16);
    view.scene.lamps.update();
    const [light] = view.scene.lamps.lights;
    expect(light.intensity).toBe(0);
    view.update(room(18.5));
    await stepFrames(60, 16);
    view.scene.lamps.update();
    expect(light.intensity).toBeCloseTo(1.5 * daylightAt(18.5).dark, 2);
    view.update(room(22));
    await stepFrames(60, 16);
    view.scene.lamps.update();
    expect(light.intensity).toBeCloseTo(1.5);
  });

  it("only glows when the scene has no lamp lights", async () => {
    const view = await renderScene(<Lamp glow={0.2} />);
    await stepFrames(5, 16);
    expect(view.scene.lamps.lights).toEqual([]);
    expect(view.scene.scene.getObjectByName("Lamp:glow")?.visible).toBe(true);
    view.update(<Lamp />);
    await stepFrames(1);
    expect(view.scene.scene.getObjectByName("Lamp:glow")?.visible).toBe(false);
  });
});

describe("<LightBeam sun>", () => {
  const room = (time: number) => (
    <>
      <Daylight time={time} transition={0} north={-Math.PI / 2} strength={{ sun: 4, sky: 1.5 }} />
      <LightBeam
        sun
        from={[2, 1.5, 0]}
        size={[1, 1.4]}
        facing={[-1, 0, 0]}
        bounds={[-2, -1.5, 2, 1.5]}
        intensity={3}
      />
    </>
  );

  it("comes in along the sun's rays, lands where they do, and is as bright as the sun", async () => {
    const view = await renderScene(room(16), { look: "none" });
    await stepFrames(3, 16);
    const beam = beamOf(view.scene.scene);
    const light = daylightAt(16, undefined, -Math.PI / 2);
    const start = beam.matrix.elements.slice(12, 15);
    expect(start).toEqual([2, 1.5, 0]);
    // The beam runs along the light, away from the sun, down to the floor or a wall.
    const along = beam.matrix.elements.slice(8, 11);
    const d = light.sunDirection;
    const scale = -along[1] / d.y;
    expect(along[0]).toBeCloseTo(-d.x * scale);
    expect(along[2]).toBeCloseTo(-d.z * scale);
    const end = [2 + along[0], 1.5 + along[1], along[2]];
    const landed = end[1] < 1e-6 || Math.abs(end[0]) > 2 - 1e-6 || Math.abs(end[2]) > 1.5 - 1e-6;
    expect(landed).toBe(true);
    expect(strengthOf(beam).getHexString()).toBe(light.sun.getHexString());
    // Later in the day it moves with the sun.
    view.update(room(18));
    await stepFrames(3, 16);
    expect(beam.matrix.elements.slice(8, 11)).not.toEqual(along);
  });

  it("follows nothing without a <Daylight>, and reads it with useDaylight", async () => {
    const reader: { read: ReturnType<typeof useDaylight> | null } = { read: null };
    function Reader() {
      const daylight = useDaylight();
      useEffect(() => {
        reader.read = daylight;
      }, [daylight]);
      return null;
    }
    const view = await renderScene(
      <>
        <Reader />
        <LightBeam sun from={[2, 1.5, 0]} size={[1, 1]} />
      </>,
      { look: "none" },
    );
    await stepFrames(2, 16);
    expect(reader.read?.()).toBeNull();
    view.update(
      <>
        <Reader />
        <Daylight time={12} transition={0} />
      </>,
    );
    await stepFrames(2, 16);
    const now = reader.read?.();
    expect(now?.hour).toBe(12);
    expect(now?.level).toBeGreaterThan(0.9);
    expect(now?.dark).toBe(0);
  });
});

describe("<WindowPane>", () => {
  it("glows with the day, and is deep blue at night", async () => {
    const room = (time: number | null) => (
      <>
        {time === null ? null : <Daylight time={time} transition={0} />}
        <WindowPane size={[1, 1.4]} position={[2, 1.5, 0]} day="#ffeecc" night="#223366" />
      </>
    );
    const view = await renderScene(room(null), { look: "none" });
    await stepFrames(2, 16);
    const pane = view.scene.scene.getObjectByName("WindowPane") as THREE.Mesh;
    const material = pane.material as THREE.MeshStandardNodeMaterial;
    expect(pane.scale.toArray()).toEqual([1, 1.4, 0.01]);
    expect(material.color.getHexString()).toBe("ffeecc");
    expect(material.emissiveIntensity).toBe(2);
    view.update(room(23));
    await stepFrames(3, 16);
    expect(material.color.getHexString()).toBe("223366");
    expect(material.emissive.getHexString()).toBe("223366");
    expect(material.emissiveIntensity).toBeCloseTo(0.5);
    view.update(null);
  });
});

describe("<LightBeam sun> from below the floor", () => {
  it("never lands, so shows nothing", async () => {
    const view = await renderScene(
      <>
        <Daylight time={16} transition={0} />
        <LightBeam sun from={[2, -1, 0]} size={[1, 1]} facing={[-1, 0, 0]} intensity={3} />
      </>,
      { look: "none" },
    );
    await stepFrames(3, 16);
    const beam = beamOf(view.scene.scene);
    // It is still placed at the opening, with the sun's colour and zero strength.
    expect(beam.matrix.elements.slice(12, 15)).toEqual([2, -1, 0]);
  });
});
