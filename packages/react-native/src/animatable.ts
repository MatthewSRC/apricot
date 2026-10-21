import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScene } from "./context";
import { optional, type SharedLike } from "./optional";

/**
 * A prop that is either a plain value or a Reanimated SharedValue, including
 * the read-only values from useDerivedValue. Without Reanimated installed,
 * only plain values are possible.
 */
export type Animatable<T> = T | SharedLike<T>;

/** Whether `value` is a Reanimated shared value (never, without Reanimated). */
export const isShared = <T>(value: unknown): value is SharedLike<T> =>
  optional.reanimated?.isSharedValue(value) === true;

const noReaction = () => {};

interface Mirror<T> {
  getDirty(): T;
  setBlocking(value: T): void;
}

// The web has no separate UI runtime or Synchronizable, so a plain variable is used there.
const createMirror = <T>(initial: T): Mirror<T> => {
  try {
    if (!optional.worklets) throw new Error("no worklets");
    return optional.worklets.createSynchronizable<T>(initial);
  } catch {
    let current = initial;
    return {
      getDirty: () => current,
      setBlocking: (next) => {
        current = next;
      },
    };
  }
};

/**
 * Returns a function that reads `value`, for use inside frame callbacks.
 *
 * Reading a shared value's `.value` from the JS thread is a slow synchronous
 * call to the UI thread. Instead, shared values are mirrored into a worklets
 * Synchronizable, which is cheap to read and a few milliseconds behind, and
 * every change wakes the scene's frame loop.
 */
export function useAnimatable<T>(value: Animatable<T>): () => T;
export function useAnimatable<T>(value: Animatable<T> | undefined): () => T | undefined;
export function useAnimatable<T>(value: Animatable<T> | undefined): () => T | undefined {
  const scene = useScene();
  const shared = isShared<T>(value) ? value : null;
  const latest = useRef(value as T | undefined);
  if (!shared) latest.current = value as T | undefined;
  const latestShared = useRef(shared);
  latestShared.current = shared;
  // Only a value that is shared at mount gets a reaction. A reaction costs a UI-runtime call to start
  // and another to stop, and most transform props are plain. Fixed at mount so the hooks never change.
  const [reacting] = useState(() => shared !== null);
  if (shared && !reacting) warnBecameShared();

  const sync = useMemo(() => (shared && reacting ? createMirror<T>(shared.value) : null), [shared, reacting]);
  const wake = useCallback(() => scene.invalidate(), [scene]);

  // Constant for the component's lifetime, so the same hook runs on every render.
  const useReaction = reacting ? (optional.reanimated?.useAnimatedReaction ?? noReaction) : noReaction;
  // Read outside the worklet, which would otherwise capture `optional` and copy whole modules to the UI thread.
  const scheduleOnRN = optional.worklets?.scheduleOnRN;
  useReaction(
    // Explicit directives, because Babel's worklets plugin recognises hooks by name and this one is
    // called useReaction.
    () => {
      "worklet";
      return shared ? shared.value : null;
    },
    (next) => {
      "worklet";
      if (sync && next !== null) {
        sync.setBlocking(next as T);
        scheduleOnRN?.(wake);
      }
    },
    [shared, sync, wake],
  );

  // A new plain value also needs a frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger, not read inside
  useEffect(() => {
    if (!shared) scene.invalidate();
  }, [shared, value, scene]);

  // A value that became shared after mount has no mirror and is read directly, which is slower.
  return useCallback(
    () => (sync ? sync.getDirty() : latestShared.current ? latestShared.current.value : latest.current),
    [sync],
  );
}

let warned = false;
const warnBecameShared = () => {
  if (warned) return;
  warned = true;
  console.warn(
    "[apricot] A prop that was a plain value is now a shared value: it is read, but changes to it don't wake the scene. Give the component a new key when it starts animating.",
  );
};
