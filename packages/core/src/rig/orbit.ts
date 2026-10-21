import { MAX_ELEVATION, shortestTurn } from "./maths";

/**
 * Touch control of the camera. One finger turns it around the subject and
 * two fingers pinch to zoom. Limits are measured from the current view.
 */
export interface OrbitOptions {
  /** Degrees the camera may turn either way from the view's azimuth (default: unlimited). */
  turn?: number;
  /**
   * Fixed azimuth range in degrees, independent of the view, such as
   * [-76, 4] to keep the back of a room out of sight. Combined with `turn`,
   * the camera stays within both.
   */
  azimuth?: readonly [number, number];
  /** Lowest and highest elevation in degrees above the horizon (default [0, 85]). */
  elevation?: readonly [number, number];
  /** Pinch zoom range as fractions of the view's distance (default [0.5, 2]), or false to disable zoom. */
  zoom?: readonly [number, number] | false;
  /** Turn speed. At 1 (default), a drag across the full canvas width turns 180°. */
  speed?: number;
  /** Whether the camera keeps turning and slows down after a flick (default true). */
  inertia?: boolean;
  /** Seconds after the last touch before the camera flies back to the view (default: never). */
  returnAfter?: number;
}

/** A finger position on the canvas, in points. */
export interface TouchPoint {
  x: number;
  y: number;
}

export interface OrbitLimits {
  azimuth: [number, number];
  elevation: [number, number];
  distance: [number, number];
}

/** Turn speed after a flick decays by e^(-FLICK_DECAY * seconds). */
export const FLICK_DECAY = 4;
/** A flick stops once it turns slower than this, in degrees per second. */
export const FLICK_STOP_SPEED = 2;
/** A finger held still longer than this before lifting, in milliseconds, does not flick. */
export const FLICK_HOLD_MS = 80;

/**
 * `next` clamped to `[low, high]`, except that a `value` already outside
 * the range may stay where it is. A camera outside its limits is not
 * snapped back, but cannot move further out.
 */
export const within = (value: number, next: number, [low, high]: readonly [number, number]) =>
  Math.min(Math.max(next, Math.min(low, value)), Math.max(high, value));

/** The distance between the first two fingers. */
export const pinchSpan = (points: readonly TouchPoint[]) =>
  Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);

/**
 * The orbit's limits for a camera at `azimuth`, measured from `view`
 * (the pose the current view resolves to).
 */
export const orbitLimits = (
  orbit: OrbitOptions,
  azimuth: number,
  view: { azimuth: number; distance: number },
): OrbitLimits => {
  const centre = shortestTurn(azimuth, view.azimuth);
  const turn = orbit.turn ?? Number.POSITIVE_INFINITY;
  let azimuthRange: [number, number] = [centre - turn, centre + turn];
  if (orbit.azimuth) {
    // Use the copy of the fixed range nearest the camera's azimuth.
    const [from, to] = orbit.azimuth;
    const half = Math.abs(to - from) / 2;
    const middle = shortestTurn(azimuth, (from + to) / 2);
    azimuthRange = [Math.max(azimuthRange[0], middle - half), Math.min(azimuthRange[1], middle + half)];
  }
  const [low, high] = orbit.elevation ?? [0, 85];
  const [near, far] = orbit.zoom === false ? [1, 1] : (orbit.zoom ?? [0.5, 2]);
  return {
    azimuth: azimuthRange,
    elevation: [Math.max(-MAX_ELEVATION, low), Math.min(MAX_ELEVATION, high)],
    distance: [view.distance * near, view.distance * far],
  };
};
