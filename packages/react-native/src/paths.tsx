import { Path, type PathOptions, Trip, type TripOptions, type TripState, type Vec3 } from "@apricotjs/core";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { type Animatable, useAnimatable } from "./animatable";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { ParentContext, type SceneObject, useAttach } from "./parent";

/** A smooth path through `points`, in metres. It is rebuilt only when the points or options change. */
export function usePath(points: readonly Vec3[], options: PathOptions = {}) {
  const key = JSON.stringify([points, options.closed ?? false, options.tension ?? 0.5]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the points and options
  return useMemo(() => new Path(points, options), [key]);
}

/** A running trip. Pass it to <FollowPath trip> and useTripStatus. */
export interface TripHandle {
  readonly trip: Trip;
  /** Seconds into the trip. */
  elapsed(): number;
  /** The trip's current state. */
  state(): TripState;
}

export interface UseTripOptions extends Omit<TripOptions, "length"> {
  /** The path it runs on, which gives "loop" trips their length. */
  path?: Path;
  /** Seconds into the trip at mount, for example from a timetable. Default 0: waiting at the first stop. */
  start?: number;
  /** Returns the current time in seconds (default the device clock). Pass a server clock to sync devices. */
  clock?: () => number;
  /** Called on arriving at a stop (its index). */
  onArrive?: (stop: number) => void;
  /** Called on leaving a stop (its index). */
  onDepart?: (stop: number) => void;
}

const deviceClock = () => performance.now() / 1000;

/**
 * Runs a vehicle along stops: it speeds up, cruises, brakes exactly onto each
 * stop, waits and moves on. It is time-based, so it is exact at any frame rate
 * and keeps its place while the app sleeps. It also works outside <Scene>,
 * next to the UI that shows its status. Pass the result to <FollowPath trip>
 * for the 3D side and to useTripStatus for the UI.
 *
 *   const trip = useTrip({ path: line, stops: [0, 900, 2100], speed: 22, dwell: 12 });
 */
export function useTrip({
  path,
  start = 0,
  clock = deviceClock,
  onArrive,
  onDepart,
  ...options
}: UseTripOptions): TripHandle {
  const key = JSON.stringify([options, path?.length, path?.closed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the options
  const trip = useMemo(() => new Trip({ ...options, length: path?.length }), [key]);
  const latest = useRef({ clock, start, onArrive, onDepart });
  latest.current = { clock, start, onArrive, onDepart };
  const origin = useMemo(() => latest.current.clock(), []);

  const handle = useMemo<TripHandle>(() => {
    const elapsed = () => latest.current.clock() - origin + latest.current.start;
    return { trip, elapsed, state: () => trip.at(elapsed()) };
  }, [trip, origin]);

  // Report arrivals and departures from timers set for when they happen, so no frames are needed.
  useEffect(() => {
    let last = handle.state();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = handle.state();
      const { onArrive, onDepart } = latest.current;
      if (now.stop !== last.stop) {
        // Reached another stop, and after a long sleep possibly left it too. Report events in order.
        if (last.stopped) onDepart?.(last.stop);
        onArrive?.(now.stop);
        if (!now.stopped) onDepart?.(now.stop);
      } else if (now.stopped !== last.stopped) {
        if (now.stopped) onArrive?.(now.stop);
        else onDepart?.(now.stop);
      }
      last = now;
      if (Number.isFinite(now.eta) && now.eta > 0) timer = setTimeout(check, now.eta * 1000 + 5);
    };
    timer = setTimeout(check, Math.max(0, last.eta) * 1000 + 5);
    return () => clearTimeout(timer);
  }, [handle]);
  return handle;
}

export interface TripStatus extends TripState {
  /** Seconds to the next stop (moving) or to departure (stopped), rounded up. */
  seconds: number;
}

/**
 * The trip's state for UI, such as "Departed · next: Tân Cảng · 0:25". It is
 * updated by a timer every `every` seconds (default 1), so it counts down
 * even while the scene sleeps at a stop. Call it in a small component of its
 * own, such as the status line, rather than in the component that renders the
 * scene, because it re-renders every `every` seconds.
 */
export function useTripStatus(trip: TripHandle, every = 1): TripStatus {
  // Read from the clock, not the frame cache: frames stop while the scene sleeps.
  const snapshot = (): TripStatus => {
    const state = trip.trip.at(trip.elapsed());
    return { ...state, seconds: Math.ceil(state.eta) };
  };
  const [status, setStatus] = useState(snapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` reads the latest trip
  useEffect(() => {
    const id = setInterval(() => {
      const next = snapshot();
      setStatus((current) =>
        current.seconds === next.seconds && current.stop === next.stop && current.stopped === next.stopped
          ? current
          : next,
      );
    }, every * 1000);
    return () => clearInterval(id);
  }, [trip, every]);
  return status;
}

export interface FollowPathProps {
  path: Path;
  /** Distance along the path, in metres (default 0). Accepts a shared value. */
  distance?: Animatable<number>;
  /** A trip (useTrip) to ride instead of `distance`. Distance and direction then come from it. */
  trip?: TripHandle;
  /** Metres ahead (+) or behind (-) of that distance along the path, such as one per car of a train. */
  offset?: number;
  /** Whether to face along the path (default true). With false, the children keep their own rotation. */
  orient?: boolean;
  ref?: Ref<SceneObject>;
  children?: ReactNode;
}

/**
 * Places its children on a path, facing along it with +z forward, such as a
 * train car, a bus or a plane on its route. Give each car of a train its own
 * FollowPath and offset, so the train bends around curves.
 *
 *   {[21, 0, -21].map((o) => <FollowPath key={o} path={line} trip={trip} offset={o}><Car /></FollowPath>)}
 */
export function FollowPath({
  path,
  distance = 0,
  trip,
  offset = 0,
  orient = true,
  ref,
  children,
}: FollowPathProps) {
  const [group] = useState(() => new THREE.Group());
  useImperativeHandle(ref, () => group, [group]);
  useAttach(group);
  const read = useAnimatable(distance);
  const scene = useScene();
  const wake = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wake.current) clearTimeout(wake.current);
    },
    [],
  );
  useFrame(() => {
    const state = trip?.state();
    const direction = state?.direction ?? 1;
    // Offsets do not flip when a trip reverses, so no car jumps. Centre them (such as [-21, 0, 21])
    // so that stops line up with the middle of the train.
    const at = (state?.distance ?? read()) + offset;
    if (orient) path.place(group, at, direction);
    else path.pointAt(at, group.position);
    if (!state) return false;
    // Render while it moves; while it waits at a stop, sleep until it leaves.
    if (wake.current) clearTimeout(wake.current);
    wake.current = null;
    if (!state.stopped) return true;
    if (Number.isFinite(state.eta) && state.eta > 0)
      wake.current = setTimeout(() => scene.invalidate(), state.eta * 1000 + 16);
    return false;
  });
  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}
