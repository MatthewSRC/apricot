import type { Footprint } from "@apricotjs/core";
import { boxAt, reachOf } from "./geometry";
import type { Measured } from "./item";

/** Cell size of a NearIndex, in metres. */
const CELL = 1;
/** Items reaching across more cells than this are returned by every query instead of being indexed. */
const WIDE = 20;

const cellKey = (i: number, j: number) => i * 100003 + j;

/** An indexed item, with how far it reaches and the floor box it covers where it is shown. */
export interface Near {
  m: Measured;
  reach: number;
  box: Footprint;
}

export interface NearIndex {
  /** The items that may reach within `reach` of (x, z). */
  around: (x: number, z: number, reach: number) => Iterable<Near>;
}

/** Calls `visit` with the key of every cell within `reach` of (x, z). */
const forCells = (x: number, z: number, reach: number, visit: (key: number) => void) => {
  for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++)
    for (let j = Math.floor((z - reach) / CELL); j <= Math.floor((z + reach) / CELL); j++)
      visit(cellKey(i, j));
};

/** A grid index of `things` by the cells they reach into, so a search only checks items near each place it tries. */
export const nearIndex = (things: Measured[]): NearIndex => {
  const cells = new Map<number, Near[]>();
  const wide: Near[] = [];
  for (const m of things) {
    const reach = reachOf(m.extent);
    const { x, z } = m.item.shown.position;
    const entry: Near = { m, reach, box: boxAt(m.extent, x, z, m.item.shown.turn) };
    if ((2 * reach) / CELL > WIDE) {
      wide.push(entry);
      continue;
    }
    forCells(x, z, reach, (key) => {
      const list = cells.get(key);
      if (list) list.push(entry);
      else cells.set(key, [entry]);
    });
  }
  return {
    around: (x, z, reach) => {
      const found = new Set<Near>(wide);
      forCells(x, z, reach, (key) => {
        for (const entry of cells.get(key) ?? []) found.add(entry);
      });
      return found;
    },
  };
};
