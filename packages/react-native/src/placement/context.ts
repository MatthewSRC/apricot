import type { Waves } from "@apricotjs/core";
import { createContext } from "react";
import type { Item } from "./item";

/** What a <Placement> shares with its <Placeable>s. */
export interface PlacementState {
  items: Map<string, Item>;
  selected: () => string | null;
  select: (id: string | null) => void;
  lift: () => number;
  /** The waves of the water area at (x, z), or null if it has none. */
  wavesAt: (x: number, z: number) => Waves | null;
  /** Call when an item is added, removed or given a new place, so the outside check runs again. */
  changed: () => void;
}

export const PlacementContext = createContext<PlacementState | null>(null);
