import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type Animatable, useAnimatable } from "../animatable";
import { renderScene } from "./render";
import { sharedValue, workletsState } from "./setup";

const capture = () => {
  const reads: { read: (() => unknown) | null } = { read: null };
  function Probe({ value }: { value: Animatable<number> | undefined }) {
    reads.read = useAnimatable(value);
    return null;
  }
  return { reads, Probe };
};

describe("useAnimatable", () => {
  it("reads plain values and their updates", async () => {
    const { reads, Probe } = capture();
    const view = await renderScene(<Probe value={1} />);
    expect(reads.read?.()).toBe(1);
    const invalidate = vi.spyOn(view.scene, "invalidate");
    view.update(<Probe value={2} />);
    expect(reads.read?.()).toBe(2);
    expect(invalidate).toHaveBeenCalled();
  });

  it("starts no reaction for a plain value, and still reads one that becomes shared later", async () => {
    const counted = globalThis as { reactionsStarted?: number };
    const before = counted.reactionsStarted ?? 0;
    const { reads, Probe } = capture();
    const view = await renderScene(<Probe value={1} />);
    expect(counted.reactionsStarted ?? 0).toBe(before);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    view.update(<Probe value={sharedValue(7) as never} />);
    expect(reads.read?.()).toBe(7);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/new key/));
    warn.mockRestore();
    // A value shared from the start gets a reaction.
    await renderScene(<Probe value={sharedValue(3) as never} />);
    expect(counted.reactionsStarted ?? 0).toBe(before + 1);
  });

  it("reads undefined when no value is given", async () => {
    const { reads, Probe } = capture();
    await renderScene(<Probe value={undefined} />);
    expect(reads.read?.()).toBeUndefined();
  });

  it("mirrors a shared value and wakes the loop when it changes", async () => {
    const { reads, Probe } = capture();
    const sv = sharedValue(5);
    const view = await renderScene(<Probe value={sv as never} />);
    expect(reads.read?.()).toBe(5);
    const invalidate = vi.spyOn(view.scene, "invalidate");
    await act(async () => {
      sv.value = 9;
    });
    expect(reads.read?.()).toBe(9);
    expect(invalidate).toHaveBeenCalled();
  });

  it("falls back to a plain mirror where Synchronizable is unsupported (web)", async () => {
    workletsState.unsupported = true;
    try {
      const { reads, Probe } = capture();
      const sv = sharedValue(1);
      await renderScene(<Probe value={sv as never} />);
      expect(reads.read?.()).toBe(1);
      await act(async () => {
        sv.value = 4;
      });
      expect(reads.read?.()).toBe(4);
    } finally {
      workletsState.unsupported = false;
    }
  });
});
