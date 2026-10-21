import { createRef, type ReactNode } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { Group } from "../Group";
import { type Place, Placeable, Placement, type PlacementHandle, type PlacementProps } from "../Placement";
import { Box } from "../shapes";
import { renderScene, stepFrames } from "./render";

const camera = { position: [0, 10, 0.001] as const, target: [0, 0, 0] as const, fov: 50 };
const groupOf = (root: THREE.Object3D, id: string) => root.getObjectByName(`Placeable:${id}`) as THREE.Group;

// A 1 × 0.5 m sofa at the middle of a 4 × 3 m room, a desk in one corner, a frame on the back wall.
const room = (props: Partial<PlacementProps> = {}, extra: ReactNode = null) => (
  <Placement bounds={[-2, -1.5, 2, 1.5]} snap={{ grid: 0.1 }} {...props}>
    <Placeable id="sofa">
      <Box size={[1, 0.5, 0.5]} position={[0, 0.25, 0]} />
    </Placeable>
    <Placeable id="desk" position={[1.5, 0, -1]} surface>
      <Box size={[0.8, 0.75, 0.5]} position={[0, 0.375, 0]} />
    </Placeable>
    <Placeable id="frame" on="wall" position={[0, 1.5, -1.5]}>
      <Box size={[0.4, 0.3, 0.03]} position={[0, 0, 0.015]} />
    </Placeable>
    {extra}
  </Placement>
);

const near = (place: Place | null, x: number, z: number) =>
  place !== null && Math.abs(place.position[0] - x) < 1e-6 && Math.abs(place.position[2] - z) < 1e-6;

describe("<Placement> footprints", () => {
  // A palm with a thin trunk and fronds 2 m across, and a chair put down under the fronds.
  const island = (palm: (fronds: ReactNode) => ReactNode, onChange = vi.fn()) => (
    <Placement bounds={[-3, -3, 3, 3]} snap={{ grid: 0.1 }} onChange={onChange}>
      {palm(<Box size={[2, 0.1, 2]} position={[0, 2, 0]} />)}
      <Placeable id="chair" position={[0.6, 0, 0]} findRoom>
        <Box size={[0.4, 0.8, 0.4]} position={[0, 0.4, 0]} />
      </Placeable>
    </Placement>
  );
  const trunk = <Box size={[0.3, 2, 0.3]} position={[0, 1, 0]} />;
  const chairMoved = async (palm: (fronds: ReactNode) => ReactNode) => {
    const onChange = vi.fn();
    const view = await renderScene(island(palm, onChange), { camera });
    await stepFrames(2);
    const moved = onChange.mock.calls.some(([id]) => id === "chair");
    view.unmount();
    return moved;
  };

  it("leaves out what is in a <Group footprint={false}>, or takes the footprint given", async () => {
    // Measured whole, the fronds are in the chair's way.
    expect(
      await chairMoved((fronds) => (
        <Placeable id="palm">
          {trunk}
          {fronds}
        </Placeable>
      )),
    ).toBe(true);
    expect(
      await chairMoved((fronds) => (
        <Placeable id="palm">
          {trunk}
          <Group footprint={false}>{fronds}</Group>
        </Placeable>
      )),
    ).toBe(false);
    expect(
      await chairMoved((fronds) => (
        <Placeable id="palm" footprint={[0.3, 0.3]}>
          {trunk}
          {fronds}
        </Placeable>
      )),
    ).toBe(false);
    // Off-centre sides reach the chair again.
    expect(
      await chairMoved((fronds) => (
        <Placeable id="palm" footprint={{ minX: -0.2, maxX: 0.5, minZ: -0.2, maxZ: 0.2 }}>
          {trunk}
          {fronds}
        </Placeable>
      )),
    ).toBe(true);
  });

  it("finds room clear of something very long, across many cells", async () => {
    const handle = createRef<PlacementHandle>();
    const view = await renderScene(
      <Placement ref={handle} bounds={[-20, -20, 20, 20]} snap={{ grid: 0.1 }}>
        <Placeable id="hedge">
          <Box size={[24, 1, 1]} position={[0, 0.5, 0]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    const [x, , z] = handle.current?.findFreePlace({ size: [1, 1, 1], near: [3, 0] })?.position ?? [0, 0, 0];
    // Beside the requested point, on a grid widened for the large area, clear of the hedge.
    expect(Math.abs(x - 3)).toBeLessThan(0.5);
    expect(Math.abs(z)).toBeGreaterThanOrEqual(1 - 1e-6);
    view.unmount();
  });

  it("counts a group's parts again once its footprint is back", async () => {
    const handle = createRef<PlacementHandle>();
    const palm = (counted: boolean) => (
      <Placement ref={handle} bounds={[-3, -3, 3, 3]} snap={{ grid: 0.1 }}>
        <Placeable id="palm">
          {trunk}
          <Group footprint={counted}>
            <Box size={[2, 0.1, 2]} position={[0, 2, 0]} />
          </Group>
        </Placeable>
      </Placement>
    );
    const view = await renderScene(palm(false), { camera });
    await stepFrames(1);
    // A 0.4 m chair fits right beside the trunk, under the fronds.
    const beside = () => handle.current?.findFreePlace({ size: [0.4, 0.8, 0.4], near: [0.4, 0] });
    expect(beside()?.position[0]).toBeCloseTo(0.4);
    view.update(palm(true));
    await stepFrames(1);
    const [x, , z] = beside()?.position ?? [0, 0, 0];
    // Clear of the fronds, which are 2 m across.
    expect(Math.max(Math.abs(x), Math.abs(z))).toBeGreaterThanOrEqual(1.2 - 1e-6);
    view.unmount();
  });
});

describe("<Placement> rooms for things", () => {
  it("finds room for a thing already there by its id: measured, and not in its own way", async () => {
    const handle = createRef<PlacementHandle>();
    const view = await renderScene(
      room(
        { ref: handle },
        <>
          <Placeable id="chair" position={[0, 0, 0.6]}>
            <Box size={[0.5, 0.9, 0.5]} position={[0, 0.45, 0]} />
          </Placeable>
          {/* Nothing in it yet (a model still loading). */}
          <Placeable id="empty" />
        </>,
      ),
      { camera },
    );
    await stepFrames(1);
    // Its own place fits, since it does not block itself.
    expect(near(handle.current?.findFreePlace({ id: "chair", near: [0, 0.6] }) ?? null, 0, 0.6)).toBe(true);
    // It uses its own turn and kind, so the sofa turned a quarter would not block the desk's side.
    const sofa = handle.current?.findFreePlace({ id: "sofa", near: [1.5, -1] });
    expect(sofa).not.toBeNull();
    expect(sofa?.turn).toBe(0);
    // Clear of the desk (0.8 wide round x 1.5) and of the room's edge.
    const [x, , z] = sofa?.position ?? [0, 0, 0];
    expect(Math.abs(x - 1.5) >= 0.9 - 1e-6 || Math.abs(z + 1) >= 0.5 - 1e-6).toBe(true);
    // Hung things find room on a wall.
    expect(handle.current?.findFreePlace({ id: "frame" })?.position[2]).toBeCloseTo(-1.5 + 0.0, 1);
    expect(handle.current?.findFreePlace({ id: "empty" })).toBeNull();
    expect(() => handle.current?.findFreePlace({ id: "nobody" })).toThrow(/none is "nobody"/);
    view.unmount();
  });

  it("moves a new thing that doesn't fit where it was put to the nearest room, before it is drawn", async () => {
    const onChange = vi.fn();
    const onArrive = vi.fn();
    const bought = (id: string, at: [number, number, number]) => (
      <Placeable id={id} position={at} findRoom>
        <Box size={[0.5, 0.9, 0.5]} position={[0, 0.45, 0]} />
      </Placeable>
    );
    const view = await renderScene(room({ onChange, onArrive }), { camera });
    await stepFrames(1);
    // Dropped on the sofa, it is hidden until checked, then moved off it and shown there at once.
    view.update(room({ onChange, onArrive }, bought("chair", [0, 0, 0])));
    const chair = groupOf(view.scene.scene, "chair");
    expect(chair.visible).toBe(false);
    await stepFrames(1);
    expect(chair.visible).toBe(true);
    const [id, place, change] = onChange.mock.calls.at(-1) as [string, Place, { by: string }];
    expect([id, change]).toEqual(["chair", { by: "arrival" }]);
    expect(place.position[2] === 0 && Math.abs(place.position[0]) < 0.75 - 1e-6).toBe(false);
    expect(chair.position.toArray()).toEqual(place.position);
    expect(onArrive).toHaveBeenLastCalledWith("chair", place);
    // Dropped where it fits, it stays and onChange is not called.
    onChange.mockClear();
    view.update(
      room(
        { onChange, onArrive },
        <>
          {bought("chair", place.position as [number, number, number])}
          {bought("stool", [-1.5, 0, 1])}
        </>,
      ),
    );
    await stepFrames(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(onArrive).toHaveBeenLastCalledWith("stool", { position: [-1.5, 0, 1], turn: 0 });
    view.unmount();
  });

  it("turns a new thing a quarter to find room, where it has none as it is", async () => {
    const onChange = vi.fn();
    // A long bench in a narrow hall fits only along it.
    const view = await renderScene(
      <Placement bounds={[-0.5, -1, 0.5, 1]} onChange={onChange}>
        <Placeable id="bench" findRoom>
          <Box size={[1.6, 0.45, 0.4]} position={[0, 0.225, 0]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    expect(onChange).toHaveBeenCalledWith("bench", { position: [0, 0, 0], turn: 90 }, { by: "arrival" });
    view.unmount();
  });

  it("says when a new thing finds no room, and shows it where it was put", async () => {
    const onArrive = vi.fn();
    const view = await renderScene(
      <Placement bounds={[-1, -1, 1, 1]} onArrive={onArrive}>
        <Placeable id="bed">
          <Box size={[2, 0.5, 2]} position={[0, 0.25, 0]} />
        </Placeable>
        <Placeable id="chair" findRoom>
          <Box size={[0.5, 0.9, 0.5]} position={[0, 0.45, 0]} />
        </Placeable>
      </Placement>,
      { camera },
    );
    await stepFrames(1);
    expect(onArrive).toHaveBeenCalledWith("chair", null);
    expect(groupOf(view.scene.scene, "chair").visible).toBe(true);
    view.unmount();
  });

  it("reports what is outside the space when it shrinks or its walls change, and moves things inside", async () => {
    const onOutside = vi.fn();
    const onChange = vi.fn();
    const handle = createRef<PlacementHandle>();
    const props = { onOutside, onChange, ref: handle };
    const view = await renderScene(room(props), { camera });
    await stepFrames(1);
    // Everything is inside, so nothing is reported.
    expect(onOutside).not.toHaveBeenCalled();
    expect(handle.current?.outside()).toEqual([]);
    // In a narrower, shallower room, the desk in a corner and the frame on the moved wall are outside.
    view.update(room({ ...props, bounds: [-1.5, -1.2, 1.5, 1.5] }));
    await stepFrames(1);
    expect(onOutside).toHaveBeenLastCalledWith(["desk", "frame"]);
    // moveInside moves them near where they were, and then nothing is outside.
    expect(handle.current?.moveInside()).toEqual([]);
    const moved = Object.fromEntries(
      onChange.mock.calls.map(([id, place, change]) => [id, { place, change }]),
    );
    expect(moved.desk.change).toEqual({ by: "code" });
    expect(moved.desk.place.position[0]).toBeLessThanOrEqual(1.5 - 0.4 + 1e-6);
    expect(moved.frame.place.position[2]).toBeCloseTo(-1.2, 1);
    expect(handle.current?.outside()).toEqual([]);
    await stepFrames(1);
    expect(onOutside).toHaveBeenLastCalledWith([]);
    // The room is too small for the sofa, so it stays and its id is returned.
    view.update(room({ ...props, bounds: [-0.3, -0.3, 0.3, 0.3] }));
    await stepFrames(1);
    expect(handle.current?.moveInside(["sofa"])).toEqual(["sofa"]);
    view.unmount();
  });

  it("carries what stands on a thing it moves inside", async () => {
    const onChange = vi.fn();
    const handle = createRef<PlacementHandle>();
    const desk = (bounds: PlacementProps["bounds"]) => (
      <Placement bounds={bounds} onChange={onChange} ref={handle}>
        <Placeable id="desk" position={[1.5, 0, 0]} surface>
          <Box size={[0.8, 0.75, 0.5]} position={[0, 0.375, 0]} />
        </Placeable>
        <Placeable id="mug" position={[1.6, 0.75, 0]} on="surface">
          <Box size={[0.1, 0.1, 0.1]} position={[0, 0.05, 0]} />
        </Placeable>
      </Placement>
    );
    const view = await renderScene(desk([-2, -2, 2, 2]), { camera });
    await stepFrames(1);
    view.update(desk([-1.5, -2, 1.5, 2]));
    await stepFrames(1);
    // The mug stands on the desk, so only the desk is outside.
    expect(handle.current?.outside()).toEqual(["desk"]);
    handle.current?.moveInside();
    const moved = Object.fromEntries(onChange.mock.calls.map(([id, place]) => [id, place as Place]));
    expect(moved.mug.position[0] - moved.desk.position[0]).toBeCloseTo(0.1);
    expect(moved.mug.position[1]).toBeCloseTo(0.75);
    view.unmount();
  });
});
