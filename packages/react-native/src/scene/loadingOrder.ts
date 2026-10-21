import { startTransition, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// Scenes that are on screen and have not drawn their content yet. A scene paused before it was
// ever shown mounts its children only once this is empty, so the scenes in view load first.
const loadingInView = new Set<object>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** Counts `token` as on screen and loading until the returned function is called. */
const countAsLoading = (token: object) => {
  loadingInView.add(token);
  notify();
  return () => {
    if (loadingInView.delete(token)) notify();
  };
};

const othersLoading = (token: object) => [...loadingInView].some((t) => t !== token);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Upper bound on the wait, for a scene in view that never draws (no GPU, an error).
const MAX_WAIT_MS = 15000;

/**
 * Whether a scene should mount its children. A scene that starts unpaused
 * mounts them at once. One that starts paused waits until it is unpaused, or
 * until no other scene in view is still loading, or MAX_WAIT_MS. The switch is
 * made in a transition so that visible scenes keep animating. Once true, it
 * stays true.
 *
 * `loading` says whether this scene is in view and has not drawn yet.
 */
export function useContentIn(paused: boolean, loading: boolean) {
  const token = useRef({}).current;
  useLayoutEffect(() => (loading ? countAsLoading(token) : undefined), [loading, token]);
  const othersStillLoading = useSyncExternalStore(
    subscribe,
    () => othersLoading(token),
    () => false,
  );
  const [contentIn, setContentIn] = useState(() => !paused);
  const [waitedEnough, setWaitedEnough] = useState(false);
  useEffect(() => {
    if (contentIn) return;
    const timer = setTimeout(() => setWaitedEnough(true), MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [contentIn]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change in `othersStillLoading` is the trigger
  useEffect(() => {
    if (contentIn) return;
    // Read the registry here rather than at render: scenes in view register as they mount. The
    // transition applies even when unpaused, so a page swiped past does not freeze the swipe.
    if (!paused || !othersLoading(token) || waitedEnough) startTransition(() => setContentIn(true));
  }, [contentIn, paused, othersStillLoading, waitedEnough, token]);
  return contentIn;
}
