import { afterEach, describe, expect, it, vi } from "vitest";
import { withQuickYields } from "../yields";

type Host = { scheduler?: { yield?: () => Promise<void>; other?: number } };
const g = globalThis as { self?: Host };
const hadSelf = "self" in g;
const savedSelf = g.self;

afterEach(() => {
  vi.useRealTimers();
  if (hadSelf) g.self = savedSelf;
  else delete g.self;
});

describe("withQuickYields", () => {
  it("continues at once within a slice, then breaks with a timer, and restores the scheduler", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    g.self = {};
    let now = 0;
    const result = withQuickYields(
      async () => {
        const scheduler = g.self?.scheduler;
        expect(scheduler?.yield).toBeTypeOf("function");
        // Within the slice: no timer.
        now = 10;
        await scheduler?.yield?.();
        expect(vi.getTimerCount()).toBe(0);
        // Past it: a real break.
        now = 60;
        const broke = scheduler?.yield?.();
        expect(vi.getTimerCount()).toBe(1);
        await vi.runAllTimersAsync();
        await broke;
        // A new slice starts after the break.
        now = 70;
        await scheduler?.yield?.();
        expect(vi.getTimerCount()).toBe(0);
        return "done";
      },
      50,
      () => now,
    );
    await expect(result).resolves.toBe("done");
    expect(g.self).not.toHaveProperty("scheduler");
  });

  it("asks a slice function at each pause, and takes the shortest of the work running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    g.self = {};
    let now = 0;
    let long = 50;
    const clock = () => now;
    const pauses = async (at: number) => {
      now = at;
      const pause = g.self?.scheduler?.yield?.();
      const broke = vi.getTimerCount() > 0;
      await vi.runAllTimersAsync();
      await pause;
      return broke;
    };
    await withQuickYields(
      async () => {
        expect(await pauses(20)).toBe(false);
        // Something showed meanwhile: shorter from now on.
        long = 8;
        expect(await pauses(30)).toBe(true);
        long = 50;
        // Beside work with a short slice: the short one applies.
        await withQuickYields(async () => expect(await pauses(40)).toBe(true), 8, clock);
      },
      () => long,
      clock,
    );
  });

  it("nests, keeps other scheduler fields, and restores them after a failure", async () => {
    const own = { other: 1 };
    g.self = { scheduler: own };
    await expect(
      withQuickYields(async () => {
        await withQuickYields(async () => {
          expect(g.self?.scheduler?.other).toBe(1);
        });
        expect(g.self?.scheduler?.yield).toBeTypeOf("function");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(g.self?.scheduler).toBe(own);
  });

  it("leaves a platform's own scheduler.yield alone, and works without self", async () => {
    const native = () => Promise.resolve();
    g.self = { scheduler: { yield: native } };
    await withQuickYields(async () => {
      expect(g.self?.scheduler?.yield).toBe(native);
    });
    delete g.self;
    await expect(withQuickYields(async () => 3)).resolves.toBe(3);
  });
});
