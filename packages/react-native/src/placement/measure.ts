import { type Extent, footprintOf } from "@apricotjs/core";
import { useRef } from "react";
import { EMPTY, type Item, type Measured } from "./item";

/** An item's extent: its measured parts, with the sides of its `footprint` prop replacing theirs. */
const extentOfItem = (item: Item): Extent => {
  const measured = footprintOf(item.group);
  if (!measured) return EMPTY;
  const given = item.footprint;
  return given ? { ...measured, ...given } : measured;
};

/**
 * Measures the items of a <Placement>. Inside `measuring`, each item is
 * measured once and the result reused, since an item's extent does not
 * change while it moves.
 */
export function useMeasure(items: Map<string, Item>) {
  const cache = useRef<Map<Item, Extent> | null>(null);
  const measuring = <T>(run: () => T): T => {
    if (cache.current) return run();
    cache.current = new Map();
    try {
      return run();
    } finally {
      cache.current = null;
    }
  };
  const measure = (item: Item): Measured => {
    const known = cache.current?.get(item);
    if (known) return { item, extent: known };
    const extent = extentOfItem(item);
    cache.current?.set(item, extent);
    return { item, extent };
  };
  /** Every item except those still arriving, measured. */
  const placed = () => {
    const all: Measured[] = [];
    for (const item of items.values()) if (!item.arriving) all.push(measure(item));
    return all;
  };
  return { measuring, measure, placed };
}
