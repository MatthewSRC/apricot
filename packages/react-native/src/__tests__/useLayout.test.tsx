import type { KeptLayout } from "@apricotjs/core";
import { act, renderHook } from "@testing-library/react";
import { Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileStorage, type LayoutStorage, useLayout } from "../useLayout";

// An in-memory stand-in for the app's documents.
const files = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-file-system", () => {
  const pathOf = (...parts: unknown[]) =>
    parts.map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri)).join("/");
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists() {
      return files.has(`${this.uri}/`);
    }
    create() {
      files.set(`${this.uri}/`, "");
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, "");
    }
    write(text: string) {
      files.set(this.uri, text);
    }
    async text() {
      return files.get(this.uri) ?? "";
    }
  }
  return { Directory, File, Paths: { document: new Directory("documents") } };
});

type Item = { id: string; position: [number, number, number]; turn: number; kind?: string };
const START: Item[] = [
  { id: "desk", position: [0, 0, 0], turn: 0 },
  { id: "lamp", position: [0, 0.75, 0], turn: 0 },
];
const memory = (kept: string | null = null) => {
  const storage = { read: vi.fn(async () => kept), write: vi.fn() } satisfies LayoutStorage;
  return storage;
};

afterEach(() => {
  vi.useRealTimers();
  files.clear();
  localStorage.clear();
});

describe("useLayout", () => {
  it("undoes and redoes, with what moves together (a desk and its lamp) one step", async () => {
    const { result } = renderHook(() => useLayout(START));
    expect(result.current.loaded).toBe(true);
    expect(result.current.canUndo).toBe(false);
    act(() => {
      // One gesture: the desk and what stands on it.
      result.current.place("desk", { position: [1, 0, 0], turn: 90 });
      result.current.place("lamp", { position: [1, 0.75, 0], turn: 90 });
    });
    await act(async () => {});
    expect(result.current.items.map((i) => i.position[0])).toEqual([1, 1]);
    // Moving to where it already is, or an unknown id, makes no step.
    act(() => result.current.place("desk", { position: [1, 0, 0], turn: 90 }));
    act(() => result.current.place("chair", { position: [1, 0, 0], turn: 90 }));
    act(() => result.current.undo());
    expect(result.current.items).toEqual(START);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.items[1].position).toEqual([1, 0.75, 0]);
    act(() => result.current.redo());
    expect(result.current.canRedo).toBe(false);
  });

  it("adds, changes, removes and replaces, each a step, and gives free ids", async () => {
    const { result } = renderHook(() => useLayout(START));
    const id = result.current.newId("chair");
    expect(id).toBe("chair-1");
    act(() => result.current.add({ id, position: [2, 0, 0], turn: 0 }));
    await act(async () => {});
    expect(result.current.newId("chair")).toBe("chair-2");
    act(() => result.current.update(id, { kind: "stool" }));
    await act(async () => {});
    expect(result.current.items[2].kind).toBe("stool");
    act(() => result.current.remove(["desk", "lamp"]));
    await act(async () => {});
    expect(result.current.items.map((i) => i.id)).toEqual(["chair-1"]);
    // Removing nothing makes no step.
    act(() => result.current.remove("desk"));
    act(() => result.current.set(START));
    await act(async () => {});
    expect(result.current.items).toEqual(START);
    for (const step of [3, 2, 1]) {
      act(() => result.current.undo());
      expect(result.current.items).toHaveLength(step === 3 ? 1 : 3);
    }
    act(() => result.current.undo());
    expect(result.current.items).toEqual(START);
    expect(result.current.canUndo).toBe(false);
  });

  it("makes a change in every step when it isn't one of its own: undo never takes a purchase back", async () => {
    const { result } = renderHook(() => useLayout(START));
    act(() => result.current.place("desk", { position: [1, 0, 0], turn: 0 }));
    await act(async () => {});
    act(() => result.current.undo());
    // Buying with a redo pending makes no step, and the item is there in every step undo or redo reaches.
    const rug: Item = { id: "rug", position: [2, 0, 0], turn: 0, kind: "rug" };
    act(() => result.current.add(rug, { history: false }));
    expect(result.current.items.map((i) => i.id)).toEqual(["desk", "lamp", "rug"]);
    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, true]);
    act(() => result.current.redo());
    expect(result.current.items.map((i) => i.id)).toEqual(["desk", "lamp", "rug"]);
    expect(result.current.items[0].position[0]).toBe(1);
    // Changed and sold the same way. Adding it again where it already is adds it once.
    act(() => result.current.update("rug", { kind: "carpet" }, { history: false }));
    act(() => result.current.add(rug, { history: false }));
    act(() => result.current.undo());
    expect(result.current.items.filter((i) => i.id === "rug")).toEqual([{ ...rug, kind: "carpet" }]);
    act(() => result.current.remove("rug", { history: false }));
    act(() => result.current.redo());
    expect(result.current.items.map((i) => i.id)).toEqual(["desk", "lamp"]);
    // After a purchase, an arrival move is applied to every step instead of making its own.
    act(() => result.current.add(rug, { history: false }));
    act(() => result.current.place("rug", { position: [3, 0, 1], turn: 90 }, { by: "arrival" }));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.items.find((i) => i.id === "rug")).toMatchObject({ position: [3, 0, 1], turn: 90 });
    // A move by hand or by code is a step to undo.
    act(() => result.current.redo());
    act(() => result.current.place("rug", { position: [1, 0, 1], turn: 0 }, { by: "code" }));
    act(() => result.current.undo());
    expect(result.current.items.find((i) => i.id === "rug")?.position).toEqual([3, 0, 1]);
    act(() => result.current.remove("rug", { history: false }));
    // The missing purchases are added in one change to every step, and nothing changes on a repeat.
    const shown = result.current;
    act(() =>
      result.current.ensure([START[0], { id: "chair", position: [0, 0, 2], turn: 0, kind: "chair" }]),
    );
    expect(result.current.items.map((i) => i.id)).toEqual(["desk", "lamp", "chair"]);
    act(() => result.current.undo());
    expect(result.current.items.some((i) => i.id === "chair")).toBe(true);
    act(() => result.current.redo());
    const after = result.current;
    act(() => result.current.ensure([START[0]]));
    expect(result.current).toBe(after);
    expect(shown).not.toBe(after);
    act(() => result.current.remove("chair", { history: false }));
    // Forgetting the steps keeps the layout as it is.
    act(() => result.current.undo());
    act(() => result.current.clearHistory());
    expect([result.current.canUndo, result.current.canRedo]).toEqual([false, false]);
    expect(result.current.items).toEqual(START);
  });

  it("starts from what was kept, and keeps changes a moment after the last", async () => {
    vi.useFakeTimers();
    const kept = JSON.stringify({ version: 2, items: [{ id: "desk", position: [3, 0, 0], turn: 0 }] });
    const storage = memory(kept);
    const { result, unmount } = renderHook(() => useLayout(START, { save: "room", version: 2, storage }));
    expect(result.current.loaded).toBe(false);
    await act(async () => {});
    expect(storage.read).toHaveBeenCalledWith("room");
    expect(result.current.loaded).toBe(true);
    expect(result.current.items).toEqual([{ id: "desk", position: [3, 0, 0], turn: 0 }]);
    // Nothing to undo, since it was loaded and not changed.
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.place("desk", { position: [4, 0, 0], turn: 0 }));
    act(() => result.current.place("desk", { position: [5, 0, 0], turn: 0 }));
    expect(storage.write).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.write.mock.calls[0][1] as string)).toEqual({
      version: 2,
      items: [{ id: "desk", position: [5, 0, 0], turn: 0 }],
    });
    // Unmounting before the write delay is over writes at once.
    act(() => result.current.undo());
    unmount();
    expect(storage.write).toHaveBeenCalledTimes(2);
  });

  it("ignores a kept layout of another version, or one that comes after a change", async () => {
    const old = JSON.stringify({ version: 1, items: [{ id: "desk", position: [3, 0, 0], turn: 0 }] });
    const { result } = renderHook(() => useLayout(START, { save: "room", version: 2, storage: memory(old) }));
    await act(async () => {});
    expect(result.current.items).toEqual(START);
    let release = () => {};
    const slow: LayoutStorage = {
      read: () =>
        new Promise((resolve) => {
          release = () => resolve(JSON.stringify({ version: 1, items: [] }));
        }),
      write: () => {},
    };
    const late = renderHook(() => useLayout(START, { save: "room", storage: slow }));
    act(() => late.result.current.remove("lamp"));
    await act(async () => release());
    expect(late.result.current.items.map((i) => i.id)).toEqual(["desk"]);
    expect(late.result.current.loaded).toBe(true);
    // An unreadable layout starts from `initial`.
    const broken: LayoutStorage = { read: () => Promise.reject(new Error("no")), write: () => {} };
    const fresh = renderHook(() => useLayout(START, { save: "room", storage: broken }));
    await act(async () => {});
    expect(fresh.result.current.items).toEqual(START);
  });

  it("migrates a layout of another version, and keeps the old one beside it", async () => {
    // Version 1 kept turns in quarter turns.
    const old = JSON.stringify({ version: 1, items: [{ id: "desk", position: [3, 0, 0], turn: 1 }] });
    const storage = memory(old);
    const migrate = ({ version, items }: KeptLayout) =>
      version === 1 ? (items as Item[]).map((item) => ({ ...item, turn: item.turn * 90 })) : null;
    const { result } = renderHook(() => useLayout(START, { save: "room", version: 2, storage, migrate }));
    await act(async () => {});
    expect(result.current.items).toEqual([{ id: "desk", position: [3, 0, 0], turn: 90 }]);
    expect(storage.write).toHaveBeenCalledWith("room.v1", old);
  });

  it("starts from `initial` when it can't read what was kept, never writing over it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const old = JSON.stringify({ version: 1, items: [{ id: "desk", position: [3, 0, 0], turn: 1 }] });
    for (const [kept, migrate, backup] of [
      // No migration for it.
      [old, undefined, "room.v1"],
      // One that throws.
      [
        old,
        () => {
          throw new Error("bad");
        },
        "room.v1",
      ],
      // Damaged, or not a layout.
      ['{"version":2,"items":[{"id":1}]}', undefined, "room.unreadable"],
      ["{", undefined, "room.unreadable"],
    ] as const) {
      const storage = memory(kept);
      const { result, unmount } = renderHook(() =>
        useLayout(START, { save: "room", version: 2, storage, migrate }),
      );
      await act(async () => {});
      expect(result.current.items).toEqual(START);
      expect(storage.write).toHaveBeenCalledWith(backup, kept);
      unmount();
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('migrating "room" failed'), expect.any(Error));
    warn.mockRestore();
  });

  it("keeps layouts in the browser's storage on the web, and in the app's documents on a phone", async () => {
    const web = fileStorage();
    expect(await web.read("room")).toBeNull();
    await web.write("room", "text");
    expect(localStorage.getItem("apricot:room")).toBe("text");
    expect(await web.read("room")).toBe("text");
    const os = Platform.OS;
    Platform.OS = "ios";
    try {
      const phone = fileStorage();
      expect(await phone.read("room")).toBeNull();
      await phone.write("room", "one");
      await phone.write("room", "two");
      expect(files.get("documents/apricot/room.json")).toBe("two");
      expect(await phone.read("room")).toBe("two");
    } finally {
      Platform.OS = os;
    }
  });
});
