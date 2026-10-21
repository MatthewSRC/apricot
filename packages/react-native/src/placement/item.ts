import type { Extent, Footprint, Placed } from "@apricotjs/core";
import type * as THREE from "three/webgpu";
import type { Place, PlaceOn } from "./types";

/** The state of one <Placeable>, shared with its <Placement>. */
export interface Item {
  id: string;
  group: THREE.Group;
  locked: boolean;
  on: PlaceOn;
  surface: boolean | number;
  solid: boolean;
  /** The place its props give it. */
  target: Place;
  /** The place it is drawn at. It eases towards `target`, or follows the finger while held. */
  shown: { position: THREE.Vector3; turn: number };
  /** True while it, or the object it stands on, is being dragged. */
  held: boolean;
  /** The last place where it fitted. It returns there if released where it does not fit. */
  fitted: Place;
  /** A <Placeable findRoom> that has not been checked yet. It is hidden and blocks nothing until then. */
  arriving?: boolean;
  /** The footprint from its props, which replaces the measured one. */
  footprint?: Footprint;
}

/** An item with its extent, measured once per operation. */
export interface Measured {
  item: Item;
  extent: Extent;
}

/** Whether the selected item fits, and the key of the inputs it was last checked at rest with. */
export interface FitState {
  id: string | null;
  fits: boolean;
  key: string;
}

/** The extent of an item with nothing to measure yet, such as a model still loading. Compared by identity. */
export const EMPTY: Extent = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

/** How close in height, in metres, an item must be to a surface's top to stand on it. */
export const ON_TOP = 0.01;

export const placedAt = (extent: Extent, x: number, z: number, turn: number): Placed => ({
  x,
  z,
  turn,
  footprint: extent,
});

export const placedOf = ({ item, extent }: Measured) =>
  placedAt(extent, item.shown.position.x, item.shown.position.z, item.shown.turn);

/** The height of a surface item's top: its extent's top, or the height given by its `surface` prop. */
export const topOf = ({ item, extent }: Measured) =>
  item.shown.position.y + (item.surface === true ? extent.maxY : Number(item.surface));

export const placeOf = (item: Item): Place => ({
  position: [item.shown.position.x, item.shown.position.y, item.shown.position.z],
  turn: item.shown.turn,
});

export const xyz = (item: Item): [number, number, number] => [
  item.shown.position.x,
  item.shown.position.y,
  item.shown.position.z,
];
