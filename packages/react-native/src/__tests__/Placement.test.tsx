import { createRef } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { type Place, Placeable, Placement, type PlacementHandle, type PlacementProps } from "../Placement";
import { Box } from "../shapes";
import { type SceneTouchListener, useSceneTouches } from "../touches";
import { fingers, renderScene, stepFrames } from "./render";

// Looking straight down from 10 m: right on screen is +x, down is +z. The
// view is 200 × 100 points, about 10.7 points a metre at the middle.
const camera = { position: [0, 10, 0.001] as const, target: [0, 0, 0] as const, fov: 50 };
const PER_METRE = 100 / (2 * 10 * Math.tan((25 * Math.PI) / 180));
const at = (x: number, z: number): [number, number] => [100 + x * PER_METRE, 50 + z * PER_METRE];

function Orbit({ listener }: { listener: SceneTouchListener }) {
  useSceneTouches(listener);
  return null;
}

const room = (props: Partial<PlacementProps> & { sofa?: [number, number, number]; turn?: number } = {}) => {
  const { sofa = [0, 0, 0], turn = 0, ...placement } = props;
  return (
    <Placement {...placement}>
      <Placeable id="sofa" position={sofa} turn={turn}>
        <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
      </Placeable>
      <Placeable id="wardrobe" position={[3, 0, 0]} locked>
        <Box size={[1, 2, 0.6]} position={[0, 1, 0]} />
      </Placeable>
    </Placement>
  );
};

const groupOf = (root: THREE.Object3D, id: string) => root.getObjectByName(`Placeable:${id}`) as THREE.Group;

describe("<Placement>", () => {
  it("picks an object up with a tap, puts it down with a tap on empty space, and never picks a locked one", async () => {
    const onSelect = vi.fn();
    const view = await renderScene(room({ onSelect }), { camera });
    await stepFrames(1);
    view.scene.press(...at(0, 0));
    expect(onSelect).toHaveBeenLastCalledWith("sofa");
    // Selecting it again reports nothing.
    view.scene.press(...at(0, 0));
    expect(onSelect).toHaveBeenCalledTimes(1);
    view.scene.press(...at(3, 0));
    expect(onSelect).toHaveBeenCalledTimes(1);
    view.scene.press(...at(-3, 2));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("takes a drag that starts on the marker round the picked-up object, not just on the object", async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const orbit = { touch: vi.fn(), release: vi.fn(() => 0) };
    // The marker reaches 0.3 m past the sofa (0.5 m deep: to z = 0.55).
    const view = await renderScene(
      <>
        {room({ onChange, onSelect, selected: "sofa", marker: { margin: 0.3 } })}
        <Orbit listener={orbit} />
      </>,
      { camera },
    );
    await stepFrames(2);
    // A tap on the marker beside the sofa keeps it selected.
    view.scene.press(...at(0, 0.45));
    expect(onSelect).not.toHaveBeenCalled();
    const f = fingers(view.container);
    await f.down([at(0, 0.45)], 0);
    await f.move([at(1, 0.45)], 16);
    await f.up(32);
    expect(orbit.touch).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      {
        position: [expect.closeTo(1, 2), 0, expect.closeTo(0, 6)],
        turn: 0,
      },
      { by: "hand" },
    );
    // A drag beyond the marker turns the camera.
    await f.down([at(-2, 1.5)], 48);
    await f.move([at(-1, 1.5)], 64);
    await f.up(80);
    expect(orbit.touch).toHaveBeenCalled();
  });

  it("moves the picked-up object under the finger, snapped and kept inside, and reports where it was put", async () => {
    const onChange = vi.fn();
    const orbit = { touch: vi.fn(), release: vi.fn(() => 0) };
    const view = await renderScene(
      <>
        {room({ onChange, selected: "sofa", snap: { grid: 0.5 }, bounds: [-2, -2, 2, 2] })}
        <Orbit listener={orbit} />
      </>,
      { camera },
    );
    await stepFrames(1);
    const f = fingers(view.container);
    // Grabbed off-centre, it keeps that offset instead of jumping to the finger.
    await f.down([at(0.3, 0)], 0);
    await f.move([at(1.4, 0.2)], 16);
    await stepFrames(1);
    const sofa = groupOf(view.scene.scene, "sofa");
    // 1.1 m right and 0.2 m down snaps to (1, 0). It is lifted while held.
    expect(sofa.position.x).toBeCloseTo(1);
    expect(sofa.position.z).toBeCloseTo(0);
    expect(sofa.position.y).toBeCloseTo(0.03);
    // Dragged past the wall, it stops with its edge on the wall, half its 1 m width inside x = 2.
    await f.move([at(5, 0)], 32);
    await stepFrames(1);
    expect(sofa.position.x).toBeCloseTo(1.5);
    await f.up(48);
    await stepFrames(1);
    expect(onChange).toHaveBeenCalledWith("sofa", { position: [1.5, 0, 0], turn: 0 }, { by: "hand" });
    expect(sofa.position.y).toBeCloseTo(0);
    // The camera never saw that drag.
    expect(orbit.touch).not.toHaveBeenCalled();
    // A drag from empty space turns the camera instead, and moves nothing.
    await f.down([at(-1, 1)], 100);
    await f.move([at(0, 1)], 116);
    await f.up(132);
    expect(orbit.touch).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("turns it with two fingers, in snapped steps, and stays put without a change", async () => {
    const onChange = vi.fn();
    const view = await renderScene(room({ onChange, selected: "sofa", snap: { turn: 45 } }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.add([at(0, 0), [150, 50]], 16);
    // The second finger swings a quarter turn anticlockwise on screen (round the first).
    await f.move([at(0, 0), [100 + 30, 50 - 30]], 32);
    await f.move([at(0, 0), [100, 0]], 48);
    await f.up(64);
    // Anticlockwise from above is +90° in three.
    expect(onChange).toHaveBeenCalledWith("sofa", { position: [0, 0, 0], turn: 90 }, { by: "hand" });
    // A tap on the selected object without moving changes nothing.
    await f.down([at(0, 0)], 100);
    await f.up(110);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("eases to new places from props, marks the picked-up object, and needs to be picked up first", async () => {
    const onChange = vi.fn();
    const view = await renderScene(room({ onChange }), { camera });
    await stepFrames(1);
    const sofa = groupOf(view.scene.scene, "sofa");
    const marker = view.scene.scene.getObjectByName("Placement:marker") as THREE.Mesh;
    const shown = () => marker.userData.marker.get().opacity > 0;
    expect(shown()).toBe(false);
    // Always in the scene, so showing it records no bundle again.
    expect(marker.visible).toBe(true);
    // When it is not selected, a drag on it turns the camera.
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    await f.move([at(1, 0)], 16);
    await f.up(32);
    expect(onChange).not.toHaveBeenCalled();
    // New props make it ease to the new place.
    view.update(room({ onChange, selected: "sofa", sofa: [1, 0, 1], turn: 90 }));
    await stepFrames(1);
    expect(sofa.position.x).toBeGreaterThan(0);
    expect(sofa.position.x).toBeLessThan(1);
    await stepFrames(30);
    expect(sofa.position.x).toBeCloseTo(1);
    expect(sofa.rotation.y).toBeCloseTo(Math.PI / 2);
    // When selected, a marker on the floor covers its turned 1 × 0.5 m footprint plus a margin.
    expect(shown()).toBe(true);
    expect(marker.position.x).toBeCloseTo(1);
    expect(marker.children[0].scale.x).toBeCloseTo(1.24);
    expect(marker.children[0].scale.y).toBeCloseTo(0.74);
    expect(marker.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("keeps solid things from overlapping (a rug lets things over it) and snaps them flush to walls", async () => {
    const onChange = vi.fn();
    const view = await renderScene(
      <Placement selected="sofa" onChange={onChange} bounds={[-3, -2, 3, 2]} snap={{ wall: 0.15 }}>
        <Placeable id="sofa">
          <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
        </Placeable>
        <Placeable id="box" position={[2, 0, 0]}>
          <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
        </Placeable>
        <Placeable id="rug" position={[-2, 0, 0]} solid={false}>
          <Box size={[1, 0.01, 1]} position={[0, 0.005, 0]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    const sofa = groupOf(view.scene.scene, "sofa");
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    // Moved into the box, it stops with its right edge on the box's left edge at 1.5.
    await f.move([at(2, 0)], 16);
    await stepFrames(1);
    expect(sofa.position.x).toBeCloseTo(1, 3);
    // It does not stop at the rug.
    await f.move([at(-2, 0)], 32);
    await stepFrames(1);
    expect(sofa.position.x).toBeCloseTo(-2);
    // Near the back wall, it snaps flush with its back edge on z = -2.
    await f.move([at(-2, -1.65)], 48);
    await stepFrames(1);
    expect(sofa.position.z).toBeCloseTo(-1.75);
    await f.up(64);
    expect(onChange).toHaveBeenLastCalledWith(
      "sofa",
      {
        position: [expect.closeTo(-2, 3), 0, expect.closeTo(-1.75)],
        turn: 0,
      },
      { by: "hand" },
    );
  });

  const desk = (props: Partial<PlacementProps> & { mug?: Place["position"] } = {}) => {
    const { mug = [2, 0, 0], ...placement } = props;
    return (
      <Placement {...placement}>
        <Placeable id="desk" surface>
          <Box size={[1.2, 0.75, 0.6]} position={[0, 0.375, 0]} />
        </Placeable>
        <Placeable id="mug" on="surface" position={mug}>
          <Box size={[0.1, 0.1, 0.1]} position={[0, 0.05, 0]} />
        </Placeable>
      </Placement>
    );
  };

  it("puts small things on top of surfaces, and moves them with what they stand on", async () => {
    const onChange = vi.fn();
    const view = await renderScene(desk({ onChange, selected: "mug" }), { camera });
    await stepFrames(1);
    const mug = groupOf(view.scene.scene, "mug");
    const f = fingers(view.container);
    await f.down([at(2, 0)], 0);
    // Over the desk, it moves up onto the 0.75 m top and is lifted while held.
    await f.move([at(0.2, 0.1)], 16);
    await stepFrames(1);
    expect(mug.position.y).toBeCloseTo(0.78);
    // Moved off the desk, it goes back down to the floor.
    await f.move([at(1.5, 0.1)], 32);
    await stepFrames(1);
    expect(mug.position.y).toBeCloseTo(0.03);
    await f.move([at(0.2, 0.1)], 48);
    await f.up(64);
    const [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    expect(placed.position[1]).toBeCloseTo(0.75);
    // The mug does not pass the desk's edge.
    expect(Math.abs(placed.position[0])).toBeLessThan(0.55);

    // Moving the desk carries the mug on it.
    onChange.mockClear();
    view.update(desk({ onChange, selected: "desk", mug: placed.position }));
    await stepFrames(1);
    await f.down([at(-0.4, 0)], 100);
    await f.move([at(-0.4, 1)], 116);
    await stepFrames(1);
    expect(mug.position.z).toBeGreaterThan(placed.position[2] + 0.8);
    await f.up(132);
    const moved = Object.fromEntries(onChange.mock.calls) as Record<string, Place>;
    expect(moved.desk.position[2]).toBeCloseTo(1);
    expect(moved.mug.position[2]).toBeCloseTo(placed.position[2] + 1);
    expect(moved.mug.position[1]).toBeCloseTo(0.75);
  });

  it("turns things by code with the same checks, carrying what stands on them", async () => {
    const onChange = vi.fn();
    const handle = createRef<PlacementHandle>();
    const view = await renderScene(desk({ onChange, ref: handle, mug: [0.5, 0.75, 0] }), { camera });
    await stepFrames(1);
    expect(handle.current?.standingOn("desk")).toEqual(["mug"]);
    expect(handle.current?.turnBy("desk", 90)).toBe(true);
    expect(onChange).toHaveBeenCalledWith("desk", { position: [0, 0, 0], turn: 90 }, { by: "code" });
    const [, mug] = onChange.mock.calls.find(([id]) => id === "mug") as [string, Place];
    // A quarter turn around the desk's middle moves +x to -z.
    expect(mug.position[0]).toBeCloseTo(0);
    expect(mug.position[2]).toBeCloseTo(-0.5);
    expect(mug.turn).toBe(90);
    expect(handle.current?.turnBy("nothing", 90)).toBe(false);
    expect(handle.current?.standingOn("nothing")).toEqual([]);

    // Wedged between two blocks, it has no room to turn.
    const blocked = await renderScene(
      <Placement ref={handle}>
        <Placeable id="sofa">
          <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
        </Placeable>
        {[-0.55, 0.55].map((z) => (
          <Placeable key={z} id={`block${z}`} position={[0, 0, z]}>
            <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
          </Placeable>
        ))}
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    expect(handle.current?.turnBy("sofa", 90)).toBe(false);
    blocked.unmount();
    view.unmount();
  });

  it("hangs things on the walls: along them, facing in, with a patch behind", async () => {
    const onChange = vi.fn();
    // The camera faces the back wall at z = -1.5 from outside the front, 6.5 m away.
    const front = { position: [0, 1.2, 5] as const, target: [0, 1.2, -1.5] as const, fov: 50 };
    const k = 50 / (6.5 * Math.tan((25 * Math.PI) / 180));
    const onWall = (x: number, y: number): [number, number] => [100 + x * k, 50 - (y - 1.2) * k];
    const view = await renderScene(
      <Placement selected="frame" onChange={onChange} bounds={[-2, -1.5, 2, 1.5]} wallHeight={2.4}>
        <Placeable id="frame" on="wall" position={[0, 1.2, -1.5]}>
          <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
        </Placeable>
      </Placement>,
      { camera: front },
    );
    await stepFrames(1);
    const frame = groupOf(view.scene.scene, "frame");
    const f = fingers(view.container);
    await f.down([onWall(0.05, 1.2)], 0);
    await f.move([onWall(0.55, 1.5)], 16);
    await stepFrames(1);
    // Lifted off the wall while held, not up.
    expect(frame.position.x).toBeCloseTo(0.5);
    expect(frame.position.y).toBeCloseTo(1.5);
    expect(frame.position.z).toBeCloseTo(-1.47);
    const marker = view.scene.scene.getObjectByName("Placement:marker") as THREE.Mesh;
    expect(marker.children[0].rotation.x).toBeCloseTo(0);
    expect(marker.children[0].scale.y).toBeCloseTo(0.54);
    // Dragged above the top of the wall, it is kept below it.
    await f.move([onWall(0.55, 2.6)], 32);
    await f.up(48);
    const [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    expect(placed.position[1]).toBeCloseTo(2.25);
    expect(placed.position[2]).toBeCloseTo(-1.5);
    expect(placed.turn).toBe(0);
  });

  it("stops hung things against each other on the same wall", async () => {
    const onChange = vi.fn();
    const front = { position: [0, 1.2, 5] as const, target: [0, 1.2, -1.5] as const, fov: 50 };
    const k = 50 / (6.5 * Math.tan((25 * Math.PI) / 180));
    const onWall = (x: number, y: number): [number, number] => [100 + x * k, 50 - (y - 1.2) * k];
    const view = await renderScene(
      <Placement selected="frame" onChange={onChange} bounds={[-2, -1.5, 2, 1.5]}>
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
    await f.move([onWall(0.5, 1.2)], 32);
    await f.up(48);
    const [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    // It stops at 0.2, with its right edge against the other's left edge at 0.4.
    expect(placed.position[0]).toBeCloseTo(0.2, 3);
    expect(placed.position[1]).toBeCloseTo(1.2);
  });

  it("takes walls of any shape: a room's outline is its floor, a free-standing wall is in the way", async () => {
    const onChange = vi.fn();
    const onFitChange = vi.fn();
    // An L (its front right cut out) with a partition across its back from x = -1.
    const l: [number, number][] = [
      [-3, -2],
      [3, -2],
      [3, 0],
      [0, 0],
      [0, 2],
      [-3, 2],
    ];
    const view = await renderScene(
      room({
        selected: "sofa",
        onChange,
        onFitChange,
        sofa: [-1.5, 0, 1],
        walls: [l, { id: "screen", from: [-1, -2], to: [-1, -1] }],
        snap: { wall: 0.15 },
      }),
      { camera },
    );
    await stepFrames(1);
    const f = fingers(view.container);
    // Towards the cut-out corner: it stops with its edge on the L's inner wall (x = 0), snapped flush.
    await f.down([at(-1.5, 1)], 0);
    await f.move([at(-0.3, 1)], 16);
    await f.move([at(0.5, 1)], 32);
    await f.up(48);
    let [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    expect(placed.position[0]).toBeCloseTo(-0.5, 2);
    expect(placed.position[2]).toBeCloseTo(1, 2);
    // Up into the back left, against the partition (x = -1): its right edge stops on the screen's face.
    view.unmount();
    const back = await renderScene(
      room({
        selected: "sofa",
        onChange,
        onFitChange,
        sofa: [-2.4, 0, -1.4],
        walls: [l, { id: "screen", from: [-1, -2], to: [-1, -1] }],
      }),
      { camera },
    );
    await stepFrames(1);
    const g = fingers(back.container);
    await g.down([at(-2.4, -1.4)], 0);
    await g.move([at(-2, -1.4)], 16);
    await g.move([at(-1.2, -1.4)], 32);
    await g.up(48);
    [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    expect(placed.position[0]).toBeLessThan(-1.5 + 1e-3);
    expect(placed.position[0]).toBeGreaterThan(-1.53);
    expect(onFitChange).not.toHaveBeenCalledWith("sofa", false);
    back.unmount();
  });

  it("hangs things on either face of a free-standing wall, the one the camera sees", async () => {
    const onChange = vi.fn();
    // Looking at a partition along x = 0 from the left, 5 m off: its left face.
    const side = { position: [-5, 1.2, 0] as const, target: [0, 1.2, 0] as const, fov: 50 };
    const k = 50 / (5 * Math.tan((25 * Math.PI) / 180));
    // Right on screen is +z (looking along +x), up is +y.
    const onFace = (z: number, y: number): [number, number] => [100 + z * k, 50 - (y - 1.2) * k];
    const frame = (position: [number, number, number], turn: number) => (
      <Placement selected="frame" onChange={onChange} walls={[{ from: [0, -2], to: [0, 2], height: 2 }]}>
        <Placeable id="frame" on="wall" position={position} turn={turn}>
          <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
        </Placeable>
      </Placement>
    );
    // Hung on the right face (turn 90: facing +x), seen from the left: dragged onto the left face.
    const view = await renderScene(frame([0, 1.2, 0.5], 90), { camera: side });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([onFace(0.5, 1.2)], 0);
    await f.move([onFace(0, 1.4)], 16);
    await f.move([onFace(-0.5, 2.5)], 32);
    await f.up(48);
    const [, placed] = onChange.mock.calls.at(-1) as [string, Place];
    // On the face the camera sees, facing it (turn 270: -x), kept under the 2 m top.
    expect(placed.turn).toBeCloseTo(270);
    expect(placed.position[0]).toBeCloseTo(0);
    expect(placed.position[1]).toBeCloseTo(1.85);
    expect(placed.position[2]).toBeCloseTo(-0.5);
    view.unmount();
  });

  it("checks the picked-up thing again when the space changes (the room grows or shrinks)", async () => {
    const onFitChange = vi.fn();
    const view = await renderScene(
      room({ selected: "sofa", onFitChange, sofa: [-2.4, 0, 0], bounds: [-3, -2, 3, 2] }),
      { camera },
    );
    await stepFrames(2);
    expect(onFitChange).not.toHaveBeenCalled();
    // After the room shrinks, it sticks out.
    view.update(room({ selected: "sofa", onFitChange, sofa: [-2.4, 0, 0], bounds: [-2, -2, 2, 2] }));
    await stepFrames(2);
    expect(onFitChange).toHaveBeenLastCalledWith("sofa", false);
    // It fits again when the room grows back, until a rule refuses every place.
    view.update(room({ selected: "sofa", onFitChange, sofa: [-2.4, 0, 0], bounds: [-3, -2, 3, 2] }));
    await stepFrames(2);
    expect(onFitChange).toHaveBeenLastCalledWith("sofa", true);
    view.update(
      room({
        selected: "sofa",
        onFitChange,
        sofa: [-2.4, 0, 0],
        bounds: [-3, -2, 3, 2],
        canPlace: () => false,
      }),
    );
    await stepFrames(2);
    expect(onFitChange).toHaveBeenLastCalledWith("sofa", false);
    view.unmount();
  });

  it("finds room for something not placed yet: on the floor, on a surface or on a wall", async () => {
    const handle = createRef<PlacementHandle>();
    const canPlace = vi.fn((id: string, place: Place) => id !== "big" || place.position[0] < 1.5);
    const view = await renderScene(
      <Placement ref={handle} bounds={[-2, -1.5, 2, 1.5]} canPlace={canPlace}>
        <Placeable id="sofa">
          <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
        </Placeable>
        <Placeable id="desk" position={[1.5, 0, -1]} surface>
          <Box size={[0.8, 0.75, 0.5]} position={[0, 0.375, 0]} />
        </Placeable>
        <Placeable id="frame" on="wall" position={[0, 1.5, -1.5]}>
          <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    const find = (options: Parameters<PlacementHandle["findFreePlace"]>[0]) =>
      handle.current?.findFreePlace(options) ?? null;
    // On the floor, as near the middle as there is room, just beside the sofa.
    const chair = find({ size: [1, 0.8, 0.5], id: "chair" }) as Place;
    expect(chair.position[0]).toBeCloseTo(0);
    expect(Math.abs(chair.position[2])).toBeCloseTo(0.5);
    expect(chair.turn).toBe(0);
    expect(canPlace).toHaveBeenCalledWith(
      "chair",
      chair,
      expect.objectContaining({ on: "floor", standingOn: null }),
    );
    // Near a point; and only where canPlace agrees.
    const near = find({ size: [0.4, 0.4, 0.4], near: [-1.5, 1] }) as Place;
    expect(near.position).toEqual([expect.closeTo(-1.5), 0, expect.closeTo(1)]);
    const big = find({ size: [1.4, 1, 1], id: "big", near: [1.8, 1] }) as Place;
    expect(big.position[0]).toBeLessThan(1.5);
    // An object bigger than the room finds no place.
    expect(find({ size: [5, 1, 1] })).toBeNull();
    // A lamp goes wholly on the desk's top.
    const lamp = find({ size: [0.2, 0.4, 0.2], on: "surface" }) as Place;
    expect(lamp.position[1]).toBeCloseTo(0.75);
    expect(Math.abs(lamp.position[0] - 1.5)).toBeLessThanOrEqual(0.3 + 1e-6);
    expect(Math.abs(lamp.position[2] + 1)).toBeLessThanOrEqual(0.15 + 1e-6);
    // A frame goes on the back wall beside the existing one, at 1.5 m, facing in.
    const frame = find({ size: [0.4, 0.3, 0.03], on: "wall", near: [0, -1.5] }) as Place;
    expect(frame.position[1]).toBeCloseTo(1.5);
    expect(frame.position[2]).toBeCloseTo(-1.5);
    expect(Math.abs(frame.position[0])).toBeCloseTo(0.4);
    expect(frame.turn).toBe(0);
    // An exact extent works instead of a size. Giving neither throws.
    const exact = find({
      extent: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 0.5 },
      near: [-2, -1.5],
    });
    expect(exact?.position).toEqual([expect.closeTo(-2), 0, expect.closeTo(-1.5)]);
    expect(() => find({})).toThrow(/size or an extent/);
    view.unmount();
  });

  it("needs a <Placement> around a <Placeable>", async () => {
    await expect(
      renderScene(
        <Placeable id="x">
          <Box />
        </Placeable>,
      ),
    ).rejects.toThrow(/inside a <Placement>/);
  });
});
