// This module does not import three.js, so tests can use the real useLayout with @apricotjs/react-native/mock.
import {
  freeId,
  type KeptLayout,
  LayoutHistory,
  type LayoutItem,
  readLayout,
  writeLayout,
} from "@apricotjs/core/layout";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { type FileSystemModule, optional } from "./optional";
import type { Place, PlaceChange } from "./placement/types";

/** Storage that keeps layouts between runs, as text by name. */
export interface LayoutStorage {
  read: (name: string) => Promise<string | null>;
  write: (name: string, text: string) => Promise<void> | void;
}

/**
 * The default storage of useLayout. It keeps layouts in an `apricot` folder
 * in the app's documents with expo-file-system, or in local storage on the
 * web. Without expo-file-system on a device nothing is kept and a warning is
 * logged once; install it, or pass your own storage.
 */
export const fileStorage = (): LayoutStorage =>
  Platform.OS === "web"
    ? {
        read: async (name) => {
          try {
            return globalThis.localStorage?.getItem(`apricot:${name}`) ?? null;
          } catch {
            return null;
          }
        },
        write: (name, text) => {
          try {
            globalThis.localStorage?.setItem(`apricot:${name}`, text);
          } catch {
            // Storage is full or not allowed, for example in a private window.
          }
        },
      }
    : optional.fileSystem
      ? filesOf(optional.fileSystem)
      : {
          // The layout still works for this run, but is not kept.
          read: async () => {
            warnNoFiles();
            return null;
          },
          write: warnNoFiles,
        };

const filesOf = ({ File, Directory, Paths }: FileSystemModule): LayoutStorage => ({
  read: async (name) => {
    const file = new File(Paths.document, "apricot", `${name}.json`);
    return file.exists ? file.text() : null;
  },
  write: (name, text) => {
    const folder = new Directory(Paths.document, "apricot");
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, `${name}.json`);
    if (!file.exists) file.create();
    file.write(text);
  },
});

let warned = false;
const warnNoFiles = () => {
  if (warned) return;
  warned = true;
  console.warn(
    "[apricot] useLayout keeps layouts with expo-file-system (npx expo install expo-file-system), or pass `storage`: this one is not kept.",
  );
};

export interface LayoutOptions<T extends LayoutItem = LayoutItem> {
  /** A name to keep the layout under between runs. It starts from the kept layout. Default: not kept. */
  save?: string;
  /**
   * The version of your item format. Default 1. Raise it when items change
   * in a way old layouts cannot follow, and give `migrate`.
   */
  version?: number;
  /**
   * Converts a layout kept by another version into this version's items, or
   * returns null if it cannot. Without it, or when it returns null, the
   * layout starts from `initial`, and the old layout is kept beside it as
   * `<save>.v<version>` (or `<save>.unreadable`) instead of being overwritten.
   */
  migrate?: (kept: KeptLayout) => T[] | null;
  /** How many steps undo can go back. Default 100. */
  history?: number;
  /** Where the layout is kept. Default: fileStorage(). */
  storage?: LayoutStorage;
}

/** Options for a change to a layout. */
export interface ChangeOptions {
  /**
   * Whether the change is its own undo step. With false, the change is
   * applied to every step in the history, so undo and redo keep it: a bought
   * item stays, and a sold one stays gone. Default true.
   */
  history?: boolean;
}

/** Options for moving an item: ChangeOptions, plus the reason that <Placement onChange> reports. */
export interface PlaceOptions extends ChangeOptions, Partial<PlaceChange> {}

/** A layout of placed items with undo and redo. See useLayout. */
export interface Layout<T extends LayoutItem> {
  items: T[];
  /**
   * Moves an item. Pass it to <Placement onChange>. The moves of one gesture
   * make one step. A move with `by: "arrival"` is applied to every step
   * instead of being a step of its own.
   */
  place: (id: string, place: Place, how?: PlaceOptions) => void;
  /** Adds an item. Give it an unused id, for example from `newId`. */
  add: (item: T, options?: ChangeOptions) => void;
  /**
   * Adds the `items` whose ids are not in the layout yet, as one change
   * applied to every step, so undo does not remove them. Use it for items
   * kept elsewhere, such as a server's list of purchases. Items already in
   * the layout are left as they are. Does nothing if none are missing.
   */
  ensure: (items: readonly T[]) => void;
  /** Changes some of an item's fields. */
  update: (id: string, change: Partial<T>, options?: ChangeOptions) => void;
  /** Removes one or more items, such as a desk and what stands on it, in one step. */
  remove: (ids: string | readonly string[], options?: ChangeOptions) => void;
  /** Replaces every item, for example to reset the layout, in one step that can be undone. */
  set: (items: T[]) => void;
  /** Undoes the last step. */
  undo: () => void;
  /** Redoes the last undone step. */
  redo: () => void;
  /** Clears the undo and redo history. The layout stays as it is. */
  clearHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Returns an id not used by any item: `prefix-1`, `prefix-2` and so on. */
  newId: (prefix: string) => string;
  /** Whether the kept layout has been read. Always true without `save`. Render the items once it is true. */
  loaded: boolean;
}

/** The version a kept layout was written with, or undefined if the text is not a layout. */
const versionOf = (text: string): unknown => {
  try {
    return (JSON.parse(text) as { version?: unknown } | null)?.version;
  } catch {
    return undefined;
  }
};

// Delay in ms after the last change before the layout is written, so a gesture is written once.
const WRITE_AFTER = 300;

/**
 * Keeps the places of objects arranged by hand, such as furniture in a
 * room, as plain data with undo and redo. With a `save` name, the layout is
 * kept between runs. Changes made together, such as a desk moved with what
 * stands on it, make one step.
 *
 *   const layout = useLayout(START, { save: "living-room" });
 *   <Placement onChange={layout.place}>
 *     {layout.loaded && layout.items.map((p) => <Placeable key={p.id} {...p}>…</Placeable>)}
 *   </Placement>
 *   <Button title="Undo" disabled={!layout.canUndo} onPress={layout.undo} />
 */
export function useLayout<T extends LayoutItem>(initial: T[], options: LayoutOptions<T> = {}): Layout<T> {
  const { save, version = 1, history: limit = 100 } = options;
  const [history] = useState(() => new LayoutHistory<T>(initial, limit));
  const [, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(save === undefined);
  const storage = useRef<LayoutStorage | null>(null);
  storage.current = options.storage ?? storage.current ?? fileStorage();
  // Changes made in the same task, such as one gesture's onChange calls, make one step.
  const together = useRef(false);
  const edited = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keep = () => {
    if (save === undefined) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      void storage.current?.write(save, writeLayout(history.present, version));
    }, WRITE_AFTER);
  };
  const shown = () => {
    setVersion((v) => v + 1);
    keep();
  };
  const commit = (next: T[]) => {
    if (next === history.present) return;
    history.commit(next, together.current);
    edited.current = true;
    if (!together.current) {
      together.current = true;
      queueMicrotask(() => {
        together.current = false;
      });
    }
    shown();
  };
  /** Applies `next` as a new step, or with `history: false` to every step. */
  const change = (next: (items: T[]) => T[], { history: step = true }: ChangeOptions = {}) => {
    if (step) return commit(next(history.present));
    history.rewrite(next);
    edited.current = true;
    shown();
  };

  // Reads the kept layout once per name. Edits made before it arrives take precedence.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per name
  useEffect(() => {
    if (save === undefined) return;
    let current = true;
    void (async () => {
      let text: string | null = null;
      try {
        text = (await storage.current?.read(save)) ?? null;
      } catch {
        // Unreadable storage starts from `initial`.
      }
      let kept: T[] | null = null;
      try {
        kept = readLayout<T>(text, version, options.migrate);
      } catch (error) {
        console.warn(`[apricot] useLayout: migrating "${save}" failed:`, error);
      }
      // A layout from another version, or one that cannot be read, is kept under another name.
      const was = text ? versionOf(text) : version;
      if (text && (was !== version || !kept)) {
        const old = typeof was === "number" && was !== version ? `${save}.v${was}` : `${save}.unreadable`;
        try {
          await storage.current?.write(old, text);
        } catch {
          // The old layout is not kept.
        }
      }
      if (!current) return;
      if (kept && !edited.current) history.reset(kept);
      setLoaded(true);
    })();
    return () => {
      current = false;
    };
  }, [save, version]);

  // A pending write happens at once on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only
  useEffect(
    () => () => {
      if (!pending.current || save === undefined) return;
      clearTimeout(pending.current);
      void storage.current?.write(save, writeLayout(history.present, version));
    },
    [],
  );

  const items = history.present;
  return {
    items,
    place: (id, place, how = {}) => {
      const at = history.present.findIndex((item) => item.id === id);
      if (at < 0) return;
      const item = history.present[at];
      const same =
        item.turn === place.turn && item.position.every((v, i) => Math.abs(v - place.position[i]) < 1e-9);
      if (same) return;
      const moved = { position: place.position, turn: place.turn };
      // An arrival is applied to every step, as if the item had been added there.
      if (!(how.history ?? how.by !== "arrival"))
        return change((items) => items.map((i) => (i.id === id ? { ...i, ...moved } : i)), {
          history: false,
        });
      const next = history.present.slice();
      next[at] = { ...item, ...moved };
      commit(next);
    },
    // Skipped in steps that already have the item, such as one undone to.
    add: (item, how) =>
      change((items) => (items.some((i) => i.id === item.id) ? items : [...items, item]), how),
    ensure: (wanted) => {
      const have = new Set(history.present.map((item) => item.id));
      if (wanted.every((item) => have.has(item.id))) return;
      change(
        (items) => {
          const there = new Set(items.map((item) => item.id));
          const missing = wanted.filter((item) => !there.has(item.id));
          return missing.length ? [...items, ...missing] : items;
        },
        { history: false },
      );
    },
    update: (id, fields, how) =>
      change((items) => items.map((item) => (item.id === id ? { ...item, ...fields } : item)), how),
    remove: (ids, how) => {
      const gone = new Set(typeof ids === "string" ? [ids] : ids);
      change((items) => {
        const next = items.filter((item) => !gone.has(item.id));
        return next.length === items.length ? items : next;
      }, how);
    },
    set: (next) => commit(next.slice()),
    undo: () => {
      if (history.undo()) shown();
    },
    redo: () => {
      if (history.redo()) shown();
    },
    clearHistory: () => {
      history.reset(history.present);
      setVersion((v) => v + 1);
    },
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    newId: (prefix) => freeId(prefix, history.present),
    loaded,
  };
}
