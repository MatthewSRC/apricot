type Yielding = { scheduler?: { yield?: () => Promise<void> } };

let original: Yielding["scheduler"];
let lastBreak = 0;
// The slice of each withQuickYields call running now. The shortest applies.
const slices = new Set<() => number>();

/** Whether withQuickYields has an effect here, which is when the platform has no scheduler.yield. */
export const quickYieldsApply = () => {
  const host = (globalThis as { self?: Yielding }).self;
  return host !== undefined && (slices.size > 0 || !host.scheduler?.yield);
};

/**
 * Runs `work`, typically three's compileAsync, with shorter pauses. three
 * compiles a few steps at a time and pauses between them with
 * `scheduler.yield()` where the platform has it, or else with
 * `requestAnimationFrame`, which waits a whole frame each time. While `work`
 * runs, a pause continues at once until `slice` milliseconds have passed
 * since the last real break, and then yields with a zero-delay timer.
 * `slice` can be a function, called at each pause. When several calls run
 * at once, the shortest slice applies. Platforms with their own
 * `scheduler.yield`, such as Chrome, keep it.
 */
export async function withQuickYields<T>(
  work: () => Promise<T>,
  slice: number | (() => number) = 50,
  now: () => number = () => performance.now(),
): Promise<T> {
  const host = (globalThis as { self?: Yielding }).self;
  if (!host || !quickYieldsApply()) return work();
  if (slices.size === 0) {
    original = host.scheduler;
    lastBreak = now();
    host.scheduler = {
      ...original,
      yield: () => {
        let shortest = Number.POSITIVE_INFINITY;
        for (const s of slices) shortest = Math.min(shortest, s());
        if (now() - lastBreak < shortest) return Promise.resolve();
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            lastBreak = now();
            resolve();
          }, 0),
        );
      },
    };
  }
  // A new function per call, so the same slice passed twice counts twice.
  const entry = typeof slice === "number" ? () => slice : () => slice();
  slices.add(entry);
  try {
    return await work();
  } finally {
    slices.delete(entry);
    if (slices.size === 0) {
      if (original === undefined) delete host.scheduler;
      else host.scheduler = original;
    }
  }
}
