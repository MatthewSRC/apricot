import type { PlacementBounds } from "./footprint";

/** A grid point waiting to be yielded: squared distance from `near`, then cell indices i and j. */
type Entry = [number, number, number];

// Nearest first; ties go by i, then j, matching gridNear's order.
const before = (a: Entry, b: Entry) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** A binary min-heap of entries, ordered by `before`. */
class EntryHeap {
  private readonly items: Entry[] = [];

  get size() {
    return this.items.length;
  }

  peek(): Entry {
    return this.items[0] as Entry;
  }

  push(entry: Entry) {
    const items = this.items;
    let at = items.push(entry) - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(entry, items[parent] as Entry)) break;
      items[at] = items[parent] as Entry;
      at = parent;
    }
    items[at] = entry;
  }

  pop(): Entry {
    const items = this.items;
    const top = items[0] as Entry;
    const end = items.pop() as Entry;
    if (items.length > 0) {
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        if (left >= items.length) break;
        const right = left + 1;
        const child =
          right < items.length && before(items[right] as Entry, items[left] as Entry) ? right : left;
        if (!before(items[child] as Entry, end)) break;
        items[at] = items[child] as Entry;
        at = child;
      }
      items[at] = end;
    }
    return top;
  }
}

/**
 * The points of a grid `step` apart (at multiples of `step`) over `area`,
 * nearest `near` first. `area` is [minX, minZ, maxX, maxZ], or along and up
 * a wall. On a large area the spacing widens by whole steps so that at
 * most about `limit` points are returned. Use gridNearEach to stop at the
 * first suitable point without generating them all.
 */
export const gridNear = (
  area: PlacementBounds,
  near: readonly [number, number],
  step: number,
  limit = 4000,
): [number, number][] => [...gridNearEach(area, near, step, limit)];

/** gridNear's points in the same order, generated lazily. */
export function* gridNearEach(
  area: PlacementBounds,
  near: readonly [number, number],
  step: number,
  limit = 4000,
): Generator<[number, number]> {
  const [minX, minZ, maxX, maxZ] = area;
  if (maxX < minX || maxZ < minZ) return;
  // Widen by whole steps so every point stays on the snap grid.
  const unit = Math.max(step, 1e-3);
  const size =
    unit * Math.max(1, Math.ceil(Math.sqrt(((maxX - minX) * (maxZ - minZ)) / limit) / unit - 1e-9));
  const i0 = Math.ceil(minX / size - 1e-9);
  const j0 = Math.ceil(minZ / size - 1e-9);
  let i1 = i0;
  while ((i1 + 1) * size <= maxX + 1e-9) i1++;
  let j1 = j0;
  while ((j1 + 1) * size <= maxZ + 1e-9) j1++;
  if (i0 * size > maxX + 1e-9 || j0 * size > maxZ + 1e-9) return;
  // Visit square rings of cells around the cell containing `near`.
  const ci = Math.round(near[0] / size);
  const cj = Math.round(near[1] / size);
  const first = Math.max(0, i0 - ci, ci - i1, j0 - cj, cj - j1);
  const last = Math.max(ci - i0, i1 - ci, cj - j0, j1 - cj);
  const heap = new EntryHeap();
  const push = (i: number, j: number) =>
    heap.push([(i * size - near[0]) ** 2 + (j * size - near[1]) ** 2, i, j]);
  // `+ 0` turns -0 into 0.
  const point = ([, i, j]: Entry): [number, number] => [i * size + 0, j * size + 0];
  for (let k = first; k <= last; k++) {
    // Ring k and all later rings are at least (k - 0.5) cells from `near`, so closer points can be yielded now.
    const reach = Math.max(0, (k - 0.5) * size);
    while (heap.size > 0 && heap.peek()[0] < reach * reach - 1e-9) yield point(heap.pop());
    for (let i = Math.max(i0, ci - k); i <= Math.min(i1, ci + k); i++) {
      if (Math.abs(i - ci) === k) {
        for (let j = Math.max(j0, cj - k); j <= Math.min(j1, cj + k); j++) push(i, j);
      } else {
        if (cj - k >= j0 && cj - k <= j1) push(i, cj - k);
        if (k > 0 && cj + k >= j0 && cj + k <= j1) push(i, cj + k);
      }
    }
  }
  while (heap.size > 0) yield point(heap.pop());
}
