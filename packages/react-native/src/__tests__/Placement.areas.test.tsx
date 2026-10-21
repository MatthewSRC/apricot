import { type Outline, Waves } from "@apricotjs/core";
import { createRef } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  type FreePlaceOptions,
  type Place,
  Placeable,
  Placement,
  type PlacementHandle,
  type PlacementProps,
} from "../Placement";
import { Box, Slab } from "../shapes";
import { Terrain } from "../Terrain";
import { useShore, Water } from "../Water";
import { fingers, renderScene, stepFrames } from "./render";

// Looking straight down from 10 m: right on screen is +x, down is +z (as in Placement.test).
const camera = { position: [0, 10, 0.001] as const, target: [0, 0, 0] as const, fov: 50 };
const PER_METRE = 100 / (2 * 10 * Math.tan((25 * Math.PI) / 180));
const at = (x: number, z: number): [number, number] => [100 + x * PER_METRE, 50 + z * PER_METRE];
const groupOf = (root: THREE.Object3D, id: string) => root.getObjectByName(`Placeable:${id}`) as THREE.Group;
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Outline => [
  [minX, minZ],
  [maxX, minZ],
  [maxX, maxZ],
  [minX, maxZ],
];

// An island from x -3 to 3 with a pool in it, rocks at its right end, a deck raised beside it, and the sea round all.
const ISLAND = rect(-3, -2, 3, 2);
const POOL = rect(-1, -1, 1, 1);
const ROCKS = rect(2, -2, 3, -1);
const DECK = rect(-6, -1, -3.2, 1);

const beach = (
  props: Partial<PlacementProps> & { lounger?: Place["position"]; duck?: Place["position"] } = {},
) => {
  const { lounger = [-2, 0, 0], duck = [0, 0, 0], ...placement } = props;
  return (
    <Placement
      areas={[
        { id: "sea", outline: rect(-9, -9, 9, 9), water: true },
        { id: "island", outline: ISLAND },
        { id: "deck", outline: DECK, level: 0.3 },
        { id: "pool", outline: POOL, water: placement.areas ? true : waves },
      ]}
      zones={[{ id: "rocks", outline: ROCKS }]}
      {...placement}
    >
      <Placeable id="lounger" position={lounger}>
        <Box size={[1, 0.3, 0.5]} position={[0, 0.15, 0]} />
      </Placeable>
      <Placeable id="duck" on="water" position={duck}>
        <Box size={[0.2, 0.2, 0.2]} position={[0, 0.1, 0]} />
      </Placeable>
    </Placement>
  );
};
const waves = new Waves({ height: 0.1, length: 1.5 });

describe("<Placement areas>", () => {
  it("keeps things inside their area, at its level, sliding along its edge", async () => {
    const onChange = vi.fn();
    const view = await renderScene(beach({ selected: "lounger", onChange }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(-2, 0)], 0);
    // Dragged off the island's bottom edge at z = 2, it slides along it with its edge on the shore.
    await f.move([at(-2.2, 1)], 16);
    await f.move([at(-2.4, 3)], 32);
    await stepFrames(1);
    const lounger = groupOf(view.scene.scene, "lounger");
    expect(lounger.position.z).toBeCloseTo(1.75, 2);
    expect(lounger.position.x).toBeLessThan(-2.2);
    // Moved onto the raised deck, it rises to the deck's level.
    await f.move([at(-4.5, 0)], 48);
    await f.up(64);
    expect(onChange).toHaveBeenLastCalledWith(
      "lounger",
      {
        position: [expect.closeTo(-4.5, 3), 0.3, expect.closeTo(0, 3)],
        turn: 0,
      },
      { by: "hand" },
    );
  });

  it("keeps things out of the water and zones, and floating things in the water", async () => {
    const canPlace = vi.fn(() => true);
    const onChange = vi.fn();
    const view = await renderScene(beach({ selected: "lounger", collide: "warn", canPlace, onChange }), {
      camera,
    });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(-2, 0)], 0);
    // It does not fit in the pool.
    await f.move([at(-0.5, 0)], 16);
    expect(canPlace).toHaveBeenLastCalledWith("lounger", expect.anything(), {
      on: "floor",
      standingOn: null,
      overlapping: [],
      area: "island",
      zones: ["pool"],
    });
    // It does not fit on the rocks either.
    await f.move([at(2.3, -1.5)], 32);
    expect(canPlace).toHaveBeenLastCalledWith(
      "lounger",
      expect.anything(),
      expect.objectContaining({ zones: ["rocks"] }),
    );
    await f.up(48);
    // Released there, it returns to where it last fitted.
    expect(onChange).not.toHaveBeenCalledWith(
      "lounger",
      expect.objectContaining({ position: [2.3, 0, -1.5] }),
      expect.anything(),
    );
    // The duck floats in the pool (on top of the island), and may not climb onto it.
    view.update(beach({ selected: "duck", collide: "warn", canPlace, onChange }));
    await stepFrames(1);
    await f.down([at(0, 0)], 64);
    await f.move([at(0.5, 0.5)], 80);
    expect(canPlace).toHaveBeenLastCalledWith("duck", expect.anything(), {
      on: "water",
      standingOn: null,
      overlapping: [],
      area: "pool",
      zones: [],
    });
    // Dragged over the island, it passes over at the island's level and is marked. Released there, it returns to the pool.
    await f.move([at(2.5, 0.5)], 96);
    await stepFrames(1);
    const duck = groupOf(view.scene.scene, "duck");
    expect(duck.position.x).toBeCloseTo(2.5, 2);
    expect(canPlace).toHaveBeenLastCalledWith(
      "duck",
      expect.anything(),
      expect.objectContaining({ area: "sea", zones: ["island"] }),
    );
    await f.up(112);
    expect(onChange).toHaveBeenLastCalledWith(
      "duck",
      {
        position: [expect.closeTo(0.5, 3), 0, expect.closeTo(0.5, 3)],
        turn: 0,
      },
      { by: "hand" },
    );
    // The lounger passes over the sea too, marked, and comes back.
    view.update(beach({ selected: "lounger", collide: "warn", canPlace, onChange }));
    await stepFrames(30);
    await f.down([at(-2, 0)], 128);
    await f.move([at(-2, 3.5)], 144);
    await stepFrames(1);
    expect(groupOf(view.scene.scene, "lounger").position.z).toBeCloseTo(3.5, 2);
    expect(canPlace).toHaveBeenLastCalledWith(
      "lounger",
      expect.anything(),
      expect.objectContaining({ area: null }),
    );
    await f.up(160);
    expect(onChange).not.toHaveBeenCalledWith(
      "lounger",
      expect.objectContaining({ position: [-2, 0, 3.5] }),
      expect.anything(),
    );
  });

  it("finds room on the ground of its kind: on land off the pool and rocks, afloat in the water", async () => {
    const handle = createRef<PlacementHandle>();
    const view = await renderScene(beach({ ref: handle }), { camera });
    await stepFrames(1);
    const find = (options: FreePlaceOptions) => handle.current?.findFreePlace(options) as Place;
    // Near the pool's middle, the nearest free land is on the island at its level.
    const [x, y, z] = find({ size: [1, 0.3, 0.5], near: [0, 0] }).position;
    expect(y).toBe(0);
    expect(Math.abs(x) >= 1.5 - 1e-6 || Math.abs(z) >= 1.25 - 1e-6).toBe(true);
    expect(Math.abs(x) <= 2.5 + 1e-6 && Math.abs(z) <= 1.75 + 1e-6).toBe(true);
    // On the raised deck, at the deck's level.
    expect(find({ size: [1, 0.3, 0.5], near: [-4.5, 0] }).position).toEqual([
      expect.closeTo(-4.5),
      0.3,
      expect.closeTo(0),
    ]);
    // Not on the rocks.
    const rocks = find({ size: [0.4, 0.3, 0.4], near: [2.5, -1.5] }).position;
    expect(rocks[0] <= 1.8 + 1e-6 || rocks[2] >= -0.8 - 1e-6).toBe(true);
    // A duck goes in the pool beside the existing one, or out at sea.
    const duck = find({ size: [0.2, 0.2, 0.2], on: "water", near: [0, 0] }).position;
    // Next to it (just touching counts as overlapping by the float rounding of their sizes).
    expect(Math.hypot(duck[0], duck[2])).toBeGreaterThanOrEqual(0.2 - 1e-6);
    expect(Math.hypot(duck[0], duck[2])).toBeLessThanOrEqual(0.3 + 1e-6);
    // Out at sea the area is large, so a wider step of 0.3 m is used.
    const sea = find({ size: [0.2, 0.2, 0.2], on: "water", near: [6, 6] }).position;
    expect(Math.hypot(sea[0] - 6, sea[2] - 6)).toBeLessThan(0.3);
    view.unmount();
  });

  it("keeps floating things in the water when things block", async () => {
    const view = await renderScene(beach({ selected: "duck", collide: "block" }), { camera });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(0, 0)], 0);
    // Dragged over the island, it is kept in the pool with its edge on the pool's edge.
    await f.move([at(2.5, 0.5)], 16);
    await stepFrames(1);
    expect(groupOf(view.scene.scene, "duck").position.x).toBeCloseTo(0.9, 2);
    await f.up(32);
  });

  it("floats things on their water's waves", async () => {
    const view = await renderScene(
      <>
        <Water size={[2, 2]} waves={waves} />
        {beach({ duck: [0.3, 0, 0.2] })}
      </>,
      { camera },
    );
    await stepFrames(2, 16);
    const duck = groupOf(view.scene.scene, "duck");
    const heights = new Set<number>();
    for (let i = 0; i < 6; i++) {
      await stepFrames(3, 50);
      heights.add(Math.round(duck.position.y * 1e4));
      // As high as the water there, tilted with it.
      expect(duck.position.y).toBeCloseTo(waves.heightAt(0.3, 0.2), 6);
    }
    expect(heights.size).toBeGreaterThan(3);
    expect(Math.abs(duck.rotation.x) + Math.abs(duck.rotation.z)).toBeGreaterThan(0);
    // The lounger on the island doesn't bob.
    expect(groupOf(view.scene.scene, "lounger").position.y).toBe(0);
  });
});

describe("<Placement snaps>", () => {
  it("pulls things near a snap point onto it, turned its way, if it takes them", async () => {
    const onChange = vi.fn();
    const snaps = [
      { at: [-2, 1.4] as const, turn: 90, radius: 0.5 },
      { at: [-2, -1.4] as const, accepts: (id: string) => id === "towel" },
    ];
    const view = await renderScene(beach({ selected: "lounger", onChange, snaps, collide: "off" }), {
      camera,
    });
    await stepFrames(1);
    const f = fingers(view.container);
    await f.down([at(-2, 0)], 0);
    await f.move([at(-2.2, 1.1)], 16);
    await f.up(32);
    expect(onChange).toHaveBeenLastCalledWith(
      "lounger",
      {
        position: [-2, 0, expect.closeTo(1.4)],
        turn: 90,
      },
      { by: "hand" },
    );
    await stepFrames(30);
    // The snap point does not accept loungers, so it stays where it is released.
    await f.down([at(-2, 1.4)], 48);
    await f.move([at(-2.1, -1.35)], 64);
    await f.up(80);
    const [, place] = onChange.mock.calls.at(-1) as [string, Place];
    expect(place.position[0]).toBeCloseTo(-2.1, 2);
  });
});

describe("<Water>, <Slab> and <Terrain>", () => {
  it("draws water that moves with its waves, and ground of any shape", async () => {
    const sea = new Waves({ height: 0.05 });
    const view = await renderScene(
      <>
        <Water size={[4, 3]} waves={sea} position={[1, 0, 0]} clarity={0.5} shallow="#00ffff" />
        <Slab outline={ISLAND} holes={[POOL]} height={0.4} color="#f0d9a8" name="island" />
      </>,
    );
    await stepFrames(3, 50);
    expect(sea.time.value).toBeGreaterThan(0);
    const water = view.scene.scene.getObjectByName("Water") as THREE.Mesh;
    expect((water.material as THREE.Material).transparent).toBe(true);
    expect(water.position.x).toBe(1);
    const island = view.scene.scene.getObjectByName("island") as THREE.Mesh;
    island.geometry.computeBoundingBox();
    expect(island.geometry.boundingBox?.max.y).toBeCloseTo(0.4);
    // Still water doesn't keep the scene drawing.
    view.update(<Water size={[4, 3]} />);
    await stepFrames(2, 16);
    const still = (view.scene.scene.getObjectByName("Water") as THREE.Mesh).material;
    expect(still).toBeTruthy();
    // Details at another scale, such as a lake seen from afar, need a new shader.
    view.update(<Water size={[4, 3]} scale={5} shoreline="#ffffff" />);
    expect((view.scene.scene.getObjectByName("Water") as THREE.Mesh).material).not.toBe(still);
  });

  it("cuts a tile of ground with the sea's depth showing in its sides, and the water knows its shore", async () => {
    const height = (x: number) => (x > 0 ? 0.2 : -0.4);
    const land = (x: number) => x > 0;
    const sand = () => "#f0d9a8";
    const fields: THREE.DataTexture[] = [];
    function Beach({ clarity }: { clarity: number }) {
      const shore = useShore(land, [-2, -1, 2, 1], { size: 16, reach: 1 });
      fields.push(shore.texture);
      return (
        <>
          <Terrain
            size={[4, 2]}
            height={height}
            spacing={0.5}
            color={sand}
            water={{ level: 0, clarity }}
            name="beach"
          />
          <Water size={[4, 2]} shore={shore} />
        </>
      );
    }
    const view = await renderScene(<Beach clarity={0.3} />);
    const beach = view.scene.scene.getObjectByName("beach") as THREE.Mesh;
    expect((beach.material as THREE.MeshStandardNodeMaterial).vertexColors).toBe(true);
    beach.geometry.computeBoundingBox();
    expect(beach.geometry.boundingBox?.max.y).toBeCloseTo(0.2);
    const glass = beach.children[0] as THREE.Mesh;
    expect((glass.material as THREE.Material).transparent).toBe(true);
    expect((glass.material as THREE.Material).opacity).toBeCloseTo(0.7);
    // A new render with the same land keeps its shore, and unmounting frees everything.
    const ground = beach.geometry;
    const dispose = vi.spyOn(ground, "dispose");
    const free = vi.spyOn(fields[0], "dispose");
    view.update(<Beach clarity={0} />);
    expect(fields.at(-1)).toBe(fields[0]);
    expect(beach.geometry).toBe(ground);
    expect((glass.material as THREE.Material).transparent).toBe(false);
    view.update(null);
    expect(dispose).toHaveBeenCalled();
    expect(free).toHaveBeenCalled();
  });
});
