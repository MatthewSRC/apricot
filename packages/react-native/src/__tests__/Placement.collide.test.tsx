import { createRef } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { type Place, Placeable, Placement, type PlacementHandle, type PlacementProps } from "../Placement";
import { Box } from "../shapes";
import { fingers, renderScene, stepFrames } from "./render";

// Looking straight down from 10 m: right on screen is +x, down is +z (as in Placement.test).
const camera = { position: [0, 10, 0.001] as const, target: [0, 0, 0] as const, fov: 50 };
const PER_METRE = 100 / (2 * 10 * Math.tan((25 * Math.PI) / 180));
const at = (x: number, z: number): [number, number] => [100 + x * PER_METRE, 50 + z * PER_METRE];

const groupOf = (root: THREE.Object3D, id: string) => root.getObjectByName(`Placeable:${id}`) as THREE.Group;
const shownOf = (root: THREE.Object3D) =>
  (root.getObjectByName("Placement:marker") as THREE.Group).userData.marker.get().opacity > 0;
const markerOf = (root: THREE.Object3D) => {
  const mesh = (root.getObjectByName("Placement:marker") as THREE.Group).children[0] as THREE.Mesh;
  const material = mesh.material as THREE.MeshBasicNodeMaterial;
  return {
    mesh,
    color: () => `#${(material.colorNode as unknown as { value: THREE.Color }).value.getHexString()}`,
  };
};

// A sofa at the origin and a box at x = 2, both 1 × 0.5 m.
const room = (props: Partial<PlacementProps> & { sofa?: [number, number, number] } = {}) => {
  const { sofa = [0, 0, 0], ...placement } = props;
  return (
    <Placement selected="sofa" bounds={[-3, -2, 3, 2]} {...placement}>
      <Placeable id="sofa" position={sofa}>
        <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
      </Placeable>
      <Placeable id="box" position={[2, 0, 0]}>
        <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
      </Placeable>
    </Placement>
  );
};

describe("<Placement collide>", () => {
  it('"warn": passes through, marks where it does not fit, and goes back there if let go', async () => {
    const onChange = vi.fn();
    const onFitChange = vi.fn();
    const view = await renderScene(room({ collide: "warn", onChange, onFitChange }), { camera });
    await stepFrames(1);
    const sofa = groupOf(view.scene.scene, "sofa");
    const marker = markerOf(view.scene.scene);
    expect(marker.color()).toBe("#4f8cff");
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.move([at(-1, 0)], 16);
    // Moved into the box, it goes in and the marker turns red.
    await f.move([at(1.8, 0)], 32);
    await stepFrames(1);
    expect(sofa.position.x).toBeCloseTo(1.8, 3);
    expect(marker.color()).toBe("#ff5a4f");
    expect(onFitChange).toHaveBeenLastCalledWith("sofa", false);
    // Released there, it returns to where it last fitted.
    await f.up(48);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      { position: [expect.closeTo(-1, 3), 0, 0], turn: 0 },
      { by: "hand" },
    );
    await stepFrames(30);
    expect(sofa.position.x).toBeCloseTo(-1, 3);
    expect(marker.color()).toBe("#4f8cff");
    expect(onFitChange).toHaveBeenLastCalledWith("sofa", true);
    // Moving through the box to the far side fits.
    await f.down([at(-1, 0)], 64);
    await f.move([at(2.5, 1)], 80);
    await f.up(96);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      {
        position: [expect.closeTo(2.5, 3), 0, expect.closeTo(1, 3)],
        turn: 0,
      },
      { by: "hand" },
    );
  });

  it("measures a thing again when its shape arrives later (a model loading)", async () => {
    const onFitChange = vi.fn();
    const onChange = vi.fn();
    // A chair at x = 1.6 beside the box, whose model is still loading and has nothing to measure.
    const late = (loaded: boolean) => (
      <Placement
        selected="chair"
        bounds={[-3, -2, 3, 2]}
        collide="warn"
        onFitChange={onFitChange}
        onChange={onChange}
      >
        <Placeable id="chair" position={[1.6, 0, 0]}>
          {loaded ? <Box size={[0.8, 0.8, 0.8]} position={[0, 0.4, 0]} /> : null}
        </Placeable>
        <Placeable id="box" position={[2, 0, 0]}>
          <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
        </Placeable>
      </Placement>
    );
    const view = await renderScene(late(false), { camera });
    await stepFrames(2);
    expect(onFitChange).not.toHaveBeenCalledWith("chair", false);
    // When the model arrives overlapping the box, it is checked again and does not fit.
    view.update(late(true));
    await stepFrames(2);
    expect(onFitChange).toHaveBeenLastCalledWith("chair", false);
    expect(markerOf(view.scene.scene).mesh.scale.x).toBeCloseTo(1.04);
    // With nothing to grab yet, a drag where it will be turns the camera.
    view.update(late(false));
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(1.6, 0)], 0);
    await f.move([at(-1, 0)], 16);
    await f.up(32);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('"off": passes through and stays where it is let go', async () => {
    const onChange = vi.fn();
    const view = await renderScene(room({ collide: "off", onChange }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.move([at(1.8, 0)], 16);
    await stepFrames(1);
    expect(markerOf(view.scene.scene).color()).toBe("#4f8cff");
    await f.up(32);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      {
        position: [expect.closeTo(1.8, 3), 0, expect.closeTo(0)],
        turn: 0,
      },
      { by: "hand" },
    );
  });

  it("marks something picked up where it overlaps", async () => {
    const onFitChange = vi.fn();
    // Put down half inside the box.
    const view = await renderScene(room({ collide: "warn", sofa: [1.5, 0, 0], onFitChange }), {
      camera,
    });
    await stepFrames(1);
    expect(markerOf(view.scene.scene).color()).toBe("#ff5a4f");
    expect(onFitChange).toHaveBeenCalledWith("sofa", false);
    // Clear of the box, it fits.
    view.update(room({ collide: "warn", sofa: [0, 0, 0], onFitChange }));
    await stepFrames(30);
    expect(markerOf(view.scene.scene).color()).toBe("#4f8cff");
  });

  it("turns by code into things, marked, and goes back to where it last fitted when put down", async () => {
    const onChange = vi.fn();
    const ref = createRef<PlacementHandle>();
    const props = { collide: "warn" as const, onChange, ref };
    // Just beside the box, a quarter turn reaches into it.
    const view = await renderScene(room({ ...props, sofa: [1.3, 0, 0.6] }), { camera });
    await stepFrames(1);
    expect(ref.current?.turnBy("sofa", 90)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith("sofa", { position: [1.3, 0, 0.6], turn: 90 }, { by: "code" });
    await stepFrames(30);
    expect(markerOf(view.scene.scene).color()).toBe("#ff5a4f");
    // Another quarter turn clears it, and it fits.
    expect(ref.current?.turnBy("sofa", 90)).toBe(true);
    await stepFrames(30);
    expect(markerOf(view.scene.scene).color()).toBe("#4f8cff");
    // Turned back into the box and put down, it returns to its last fitting turn.
    expect(ref.current?.turnBy("sofa", -90)).toBe(true);
    await stepFrames(30);
    expect(markerOf(view.scene.scene).color()).toBe("#ff5a4f");
    view.update(room({ ...props, sofa: [1.3, 0, 0.6], selected: null }));
    await stepFrames(1);
    expect(onChange).toHaveBeenLastCalledWith("sofa", { position: [1.3, 0, 0.6], turn: 180 }, { by: "hand" });
  });
});

describe("<Placeable> shadows", () => {
  it("casts no shadow while moved or easing, so the shadow map is not redrawn every frame", async () => {
    const view = await renderScene(room({ collide: "warn" }), { camera, shadows: true });
    await stepFrames(1);
    const shadows = view.scene.shadows as NonNullable<typeof view.scene.shadows>;
    const pause = vi.spyOn(shadows, "pause");
    const sofa = groupOf(view.scene.scene, "sofa");
    const casts = () => (sofa.children[0] as THREE.Mesh).castShadow;
    expect(casts()).toBe(true);
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.move([at(-1, 0)], 16);
    await stepFrames(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(casts()).toBe(false);
    await f.move([at(-1.5, 0.5)], 32);
    await f.up(48);
    await stepFrames(30);
    expect(casts()).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

describe("<Placement canPlace>", () => {
  // Nothing past x = 1 (a no-go zone).
  const notPastOne = (_id: string, place: Place) => place.position[0] <= 1;

  it("stops things at your own limits, as against others", async () => {
    const onChange = vi.fn();
    const canPlace = vi.fn(notPastOne);
    const view = await renderScene(room({ canPlace, onChange, sofa: [0, 0, 1] }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(0, 1)], 0);
    await f.move([at(0.8, 1)], 16);
    await f.move([at(1.6, 1)], 32);
    await f.up(48);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      { position: [expect.closeTo(0.8, 3), 0, 1], turn: 0 },
      { by: "hand" },
    );
    expect(canPlace).toHaveBeenCalledWith("sofa", expect.anything(), {
      on: "floor",
      standingOn: null,
      area: null,
      zones: [],
      overlapping: [],
    });
  });

  it('with "warn", marks where it says no, tells what it overlaps, and sends things back', async () => {
    const onChange = vi.fn();
    const canPlace = vi.fn(notPastOne);
    const view = await renderScene(room({ collide: "warn", canPlace, onChange }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.move([at(0.5, 1)], 16);
    await f.move([at(2.5, 1)], 32);
    await stepFrames(1);
    expect(markerOf(view.scene.scene).color()).toBe("#ff5a4f");
    await f.move([at(1.6, 0)], 48);
    expect(canPlace).toHaveBeenLastCalledWith("sofa", expect.anything(), {
      on: "floor",
      standingOn: null,
      area: null,
      zones: [],
      overlapping: ["box"],
    });
    await f.up(64);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      {
        position: [expect.closeTo(0.5, 3), 0, expect.closeTo(1, 3)],
        turn: 0,
      },
      { by: "hand" },
    );
  });

  it("says what a thing would stand on, and refuses turns by code", async () => {
    const canPlace = vi.fn((_id: string, place: Place) => place.turn === 0);
    const ref = createRef<PlacementHandle>();
    await renderScene(
      <Placement selected="mug" canPlace={canPlace} ref={ref}>
        <Placeable id="desk" surface>
          <Box size={[1.2, 0.75, 0.6]} position={[0, 0.375, 0]} />
        </Placeable>
        <Placeable id="mug" on="surface" position={[0.2, 0.75, 0]}>
          <Box size={[0.1, 0.1, 0.1]} position={[0, 0.05, 0]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    expect(canPlace).toHaveBeenLastCalledWith("mug", expect.anything(), {
      on: "surface",
      standingOn: "desk",
      area: null,
      zones: [],
      overlapping: [],
    });
    expect(ref.current?.turnBy("mug", 45)).toBe(false);
  });
});

describe("<Placement marker>", () => {
  it("takes a look: colours, margin, rounding, a ring; or none", async () => {
    const look = {
      color: "#33cc66",
      blocked: "#aa00ff",
      margin: 0.2,
      radius: 0.5,
      outline: 0.03,
      opacity: 0.5,
    };
    const view = await renderScene(room({ collide: "warn", sofa: [1.5, 0, 0], marker: look }), { camera });
    await stepFrames(1);
    const marker = markerOf(view.scene.scene);
    expect(marker.color()).toBe("#aa00ff");
    // 1 × 0.5 m, and 0.2 m past it on each side.
    expect(marker.mesh.scale.x).toBeCloseTo(1.4);
    expect(marker.mesh.scale.y).toBeCloseTo(0.9);
    view.update(room({ collide: "warn", marker: look }));
    await stepFrames(30);
    expect(marker.color()).toBe("#33cc66");
    view.update(room({ marker: false }));
    await stepFrames(1);
    // With nothing selected it is faded out but stays in the scene, so showing it again changes nothing a bundle records.
    expect(shownOf(view.scene.scene)).toBe(false);
  });

  it("marks hung things that overlap on their wall", async () => {
    const onChange = vi.fn();
    const front = { position: [0, 1.2, 5] as const, target: [0, 1.2, -1.5] as const, fov: 50 };
    const k = 50 / (6.5 * Math.tan((25 * Math.PI) / 180));
    const onWall = (x: number, y: number): [number, number] => [100 + x * k, 50 - (y - 1.2) * k];
    const view = await renderScene(
      <Placement selected="frame" collide="warn" onChange={onChange} bounds={[-2, -1.5, 2, 1.5]}>
        <Placeable id="frame" on="wall" position={[-0.6, 1.2, -1.5]}>
          <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
        </Placeable>
        <Placeable id="other" on="wall" position={[0.6, 1.2, -1.5]}>
          <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
        </Placeable>
      </Placement>,
      { camera: front },
    );
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([onWall(-0.6, 1.2)], 0);
    await f.move([onWall(0, 1.2)], 16);
    // Over the other frame, the marker is red.
    await f.move([onWall(0.5, 1.2)], 32);
    await stepFrames(1);
    expect(markerOf(view.scene.scene).color()).toBe("#ff5a4f");
    await f.up(48);
    const [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    expect(placed.position[0]).toBeCloseTo(0, 3);
    // Selected where it fits on its wall, the marker is blue.
    await stepFrames(30);
    expect(markerOf(view.scene.scene).color()).toBe("#4f8cff");
  });
});
