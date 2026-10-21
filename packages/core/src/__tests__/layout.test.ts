import { describe, expect, it, vi } from "vitest";
import { freeId, type KeptLayout, LayoutHistory, type LayoutItem, readLayout, writeLayout } from "../layout";

const sofa: LayoutItem = { id: "sofa", position: [0, 0, 0], turn: 0 };
const moved: LayoutItem = { id: "sofa", position: [1, 0, 0], turn: 90 };

describe("layout history", () => {
  it("undoes and redoes steps, merges what goes together, and forgets redo on a new step", () => {
    const history = new LayoutHistory([sofa]);
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    expect(history.undo()).toBe(false);
    history.commit([moved]);
    history.commit([moved, sofa], true);
    expect(history.present).toEqual([moved, sofa]);
    // One step back: before both.
    expect(history.undo()).toBe(true);
    expect(history.present).toEqual([sofa]);
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(true);
    expect(history.present).toEqual([moved, sofa]);
    expect(history.redo()).toBe(false);
    history.undo();
    history.commit([]);
    expect(history.canRedo).toBe(false);
    // The same layout again: no step.
    const now = history.present;
    history.commit(now);
    history.undo();
    expect(history.present).toEqual([sofa]);
  });

  it("keeps a limited number of steps, and starts again from a loaded layout", () => {
    const history = new LayoutHistory<LayoutItem>([], 2);
    for (let i = 1; i <= 4; i++) history.commit([{ ...sofa, turn: i }]);
    expect(history.undo() && history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    expect(history.present[0].turn).toBe(2);
    history.reset([moved]);
    expect([history.canUndo, history.canRedo, history.present]).toEqual([false, false, [moved]]);
  });

  it("rewrites every step: something bought is there whichever step undo or redo goes to", () => {
    const history = new LayoutHistory<LayoutItem>([sofa]);
    history.commit([moved]);
    history.undo();
    const lamp: LayoutItem = { id: "lamp", position: [2, 0, 0], turn: 0 };
    history.rewrite((items) => [...items, lamp]);
    expect(history.present).toEqual([sofa, lamp]);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(history.present).toEqual([moved, lamp]);
    history.undo();
    expect(history.present).toEqual([sofa, lamp]);
  });
});

describe("layout text", () => {
  it("reads back what it wrote, for the same version only", () => {
    const text = writeLayout([sofa, moved], 3);
    expect(readLayout(text, 3)).toEqual([sofa, moved]);
    expect(readLayout(text, 2)).toBeNull();
    expect(readLayout(writeLayout([sofa]))).toEqual([sofa]);
    // Its own fields come back too.
    const rug = { ...sofa, id: "rug", kind: "rug", colour: "#c33" };
    expect(readLayout(writeLayout([rug]))).toEqual([rug]);
  });

  it("gives a layout of another version to `migrate`, and checks what comes back", () => {
    // Version 1 kept turns in quarter turns; version 2 in degrees.
    const old = writeLayout([{ ...sofa, turn: 1 }], 1);
    const migrate = vi.fn(({ version, items }: KeptLayout) =>
      version === 1 ? (items as LayoutItem[]).map((item) => ({ ...item, turn: item.turn * 90 })) : null,
    );
    expect(readLayout(old, 2, migrate)).toEqual([{ ...sofa, turn: 90 }]);
    expect(migrate).toHaveBeenCalledWith({ version: 1, items: [{ ...sofa, turn: 1 }] });
    // Not one it knows: null.
    expect(readLayout(writeLayout([sofa], 7), 2, migrate)).toBeNull();
    // Not given the same version, nor what isn't a layout.
    migrate.mockClear();
    expect(readLayout(writeLayout([sofa], 2), 2, migrate)).toEqual([sofa]);
    expect(readLayout("{", 2, migrate)).toBeNull();
    expect(migrate).not.toHaveBeenCalled();
    // What it returns must be a layout.
    expect(readLayout(old, 2, () => [{ id: "x" }] as unknown as LayoutItem[])).toBeNull();
  });

  it("ignores what isn't a layout", () => {
    for (const text of [null, "", "{", "[]", '{"version":1}', '{"version":1,"items":[{"id":1}]}'])
      expect(readLayout(text)).toBeNull();
    expect(readLayout('{"version":1,"items":[{"id":"a","position":[0,"x",0],"turn":0}]}')).toBeNull();
    expect(readLayout('{"version":1,"items":[{"id":"a","position":[0,0,0],"turn":"0"}]}')).toBeNull();
    expect(readLayout("null")).toBeNull();
  });

  it("finds a free id", () => {
    expect(freeId("chair", [])).toBe("chair-1");
    expect(freeId("chair", [{ id: "chair-1" }, { id: "chair-3" }])).toBe("chair-2");
  });
});
