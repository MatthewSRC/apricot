import type { TouchPoint } from "@apricotjs/core";
import { createContext, useContext, useEffect, useRef } from "react";

/** Receives the touches on a <Scene>'s canvas, as a drag-to-orbit camera does. */
export interface SceneTouchListener {
  /**
   * Called when a gesture starts with the fingers at `points`. Return true
   * to take the whole gesture so that no other listener receives it; for
   * example, a finger on a selected object moves the object instead of the
   * camera. The first listener to return true takes it.
   */
  capture?(points: TouchPoint[], time: number): boolean;
  /** Called on every start and move with the fingers down, in points from the scene's top-left corner, at `time` in milliseconds. */
  touch(points: TouchPoint[], time: number): void;
  /** Called when all fingers have lifted. Returns how far they moved, in points. */
  release(time: number): number;
  /** Called on the web when the mouse wheel turns. `deltaY` is positive when it turns away from the user. */
  wheel?(deltaY: number): void;
}

/** The listeners on a scene. `changed` is called when one is added or removed. */
export type SceneTouches = Set<SceneTouchListener> & { changed?: () => void };

export const TouchContext = createContext<SceneTouches | null>(null);

/**
 * Listens to touches on the enclosing <Scene> while `active`. The scene then
 * claims touches that start on it, so drags turn the camera instead of
 * reaching views behind it. Taps on objects still work.
 */
export function useSceneTouches(listener: SceneTouchListener, active = true) {
  const touches = useContext(TouchContext);
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!touches || !active) return;
    const forward: SceneTouchListener = {
      capture: (points, time) => latest.current.capture?.(points, time) === true,
      touch: (points, time) => latest.current.touch(points, time),
      release: (time) => latest.current.release(time),
      wheel: (deltaY) => latest.current.wheel?.(deltaY),
    };
    touches.add(forward);
    touches.changed?.();
    return () => {
      touches.delete(forward);
      touches.changed?.();
    };
  }, [touches, active]);
}
