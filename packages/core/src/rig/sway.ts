/** A slow swing back and forth around the view's azimuth. See CameraRig.sway. */
export interface SwayOptions {
  /** How far the camera swings either way, in degrees (default 12). */
  degrees?: number;
  /** Seconds for one full swing there and back (default 12). */
  period?: number;
}

/** Seconds taken to blend from where the camera was left into the swing. */
const BLEND_SECONDS = 1.5;

export const sameSway = (a: SwayOptions | null, b: SwayOptions | null) =>
  a === b || (!!a && !!b && a.degrees === b.degrees && a.period === b.period);

/** The state of a sway: where it is in its swing and how far it has blended in. */
export class Swing {
  /** Radians. */
  private phase = 0;
  /** From 0 (just restarted) to 1 (fully swinging). */
  private blend = 1;
  /** The azimuth the camera blends from. */
  private start = 0;

  /** Blends back into the swing from wherever the camera is on the next step. */
  restart() {
    this.blend = 0;
  }

  /** Advances by `delta` seconds and returns the new azimuth for a camera now at `azimuth`. */
  step(azimuth: number, centre: number, delta: number, options: SwayOptions) {
    const degrees = options.degrees ?? 12;
    const period = Math.max(0.1, options.period ?? 12);
    if (this.blend === 0) {
      // Start at a phase whose offset matches the camera's, so the swing begins without a jump.
      const offset = Math.max(-1, Math.min(1, (azimuth - centre) / Math.max(degrees, 1e-6)));
      this.phase = Math.PI - Math.asin(offset);
      this.start = azimuth;
    }
    this.phase += (2 * Math.PI * delta) / period;
    const goal = centre + degrees * Math.sin(this.phase);
    this.blend = Math.min(1, this.blend + delta / BLEND_SECONDS);
    const t = this.blend;
    const smooth = t * t * (3 - 2 * t);
    return this.start + (goal - this.start) * smooth;
  }
}
