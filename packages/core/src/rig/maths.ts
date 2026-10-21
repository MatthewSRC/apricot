export const DEG = Math.PI / 180;

/** Highest elevation in degrees. Straight down has no "up" direction for lookAt. */
export const MAX_ELEVATION = 89.9;

export const clampElevation = (elevation: number) =>
  Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, elevation));

/** Cubic ease-in-out of `t` in [0, 1]. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** `to` shifted by whole turns so it is within 180° of `from`, in degrees. */
export const shortestTurn = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180;
