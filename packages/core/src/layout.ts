import type { Vec3 } from "./spin";

/** One placed object in a layout: its id, position and turn in degrees (see <Placement onChange>). */
export interface LayoutItem {
  id: string;
  position: Vec3;
  turn: number;
}

/**
 * Undo and redo history for a layout. Holds the current layout, earlier
 * ones and undone ones, keeping at most `limit` undo steps.
 */
export class LayoutHistory<T> {
  private past: T[][] = [];
  private future: T[][] = [];

  constructor(
    public present: T[],
    private readonly limit = 100,
  ) {}

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Makes `next` the current layout as a new step, or as part of the last step when `merge` is true. Clears redo. */
  commit(next: T[], merge = false) {
    if (next === this.present) return;
    if (!merge) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.present = next;
  }

  /** Goes back one step. Returns false if there is nothing to undo. */
  undo() {
    const before = this.past.pop();
    if (!before) return false;
    this.future.push(this.present);
    this.present = before;
    return true;
  }

  /** Reapplies one undone step. Returns false if there is nothing to redo. */
  redo() {
    const after = this.future.pop();
    if (!after) return false;
    this.past.push(this.present);
    this.present = after;
    return true;
  }

  /**
   * Applies `change` to every step: current, undo and redo. Use it for
   * permanent changes, such as a purchased item, that must survive undo and
   * redo.
   */
  rewrite(change: (items: T[]) => T[]) {
    this.past = this.past.map(change);
    this.future = this.future.map(change);
    this.present = change(this.present);
  }

  /** Replaces the history with `items` and nothing to undo or redo, for example after loading a layout. */
  reset(items: T[]) {
    this.past = [];
    this.future = [];
    this.present = items;
  }
}

/**
 * A layout as stored by writeLayout: JSON `{ "version": 1, "items": [...] }`,
 * where each item is `{ "id", "position": [x, y, z], "turn", ...custom fields }`.
 */
export interface KeptLayout {
  /** The app's layout version when it was written (see readLayout). */
  version: unknown;
  items: unknown[];
}

/** Serialises `items` with the app's layout `version` (see KeptLayout). */
export const writeLayout = <T extends LayoutItem>(items: readonly T[], version = 1) =>
  JSON.stringify({ version, items });

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => typeof v === "number" && Number.isFinite(v));

/**
 * Parses a layout stored with writeLayout. Returns null if `text` is empty
 * or invalid. A layout written with a different `version` is passed to
 * `migrate`, which returns the items in the current form or null if it
 * cannot convert them. Without `migrate`, such a layout returns null.
 */
export const readLayout = <T extends LayoutItem>(
  text: string | null | undefined,
  version = 1,
  migrate?: (kept: KeptLayout) => T[] | null,
): T[] | null => {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const { version: was, items: kept } = (data ?? {}) as { version?: unknown; items?: unknown };
  if (!Array.isArray(kept)) return null;
  const items: unknown[] | null = was === version ? kept : (migrate?.({ version: was, items: kept }) ?? null);
  if (!Array.isArray(items)) return null;
  const ok = items.every(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as LayoutItem).id === "string" &&
      isVec3((item as LayoutItem).position) &&
      typeof (item as LayoutItem).turn === "number",
  );
  return ok ? (items as T[]) : null;
};

/** The first of `prefix-1`, `prefix-2`, ... not used as an id in `items`. */
export const freeId = (prefix: string, items: readonly { id: string }[]) => {
  const taken = new Set(items.map((item) => item.id));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};
