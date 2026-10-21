export interface TripOptions {
  /** Distances of the stops along the path in metres, in order. */
  stops: readonly number[];
  /** Top speed in metres per second (default 20). */
  speed?: number;
  /** Acceleration in m/s² (default 1.2). */
  acceleration?: number;
  /** Deceleration in m/s² (default: `acceleration`). */
  deceleration?: number;
  /** Seconds at each stop (default 8). */
  dwell?: number;
  /**
   * What happens after the last stop. "shuttle" (default) runs back through
   * the stops in reverse, "loop" continues to the first stop around a
   * closed path of `length`, and "once" stays at the last stop.
   */
  pattern?: "shuttle" | "loop" | "once";
  /** Path length in metres. Required for "loop". */
  length?: number;
}

export interface TripState {
  /** Distance along the path in metres. */
  distance: number;
  /** Speed in metres per second (0 at a stop). */
  speed: number;
  /** +1 going forward along the path, -1 going back. */
  direction: 1 | -1;
  /** True while waiting at a stop. */
  stopped: boolean;
  /** Index into `stops` of the stop it is waiting at, or last left when moving. */
  stop: number;
  /** Index into `stops` of the stop it is heading for. */
  nextStop: number;
  /** Seconds until it reaches the next stop when moving, or until it leaves when stopped. */
  eta: number;
}

interface Leg {
  from: number;
  to: number;
  fromStop: number;
  toStop: number;
  /** Departure time in seconds, after the dwell at `fromStop`. */
  start: number;
  accelTime: number;
  cruiseTime: number;
  decelTime: number;
  peak: number;
  end: number;
}

/**
 * The timeline of a vehicle running a line with stops. It accelerates,
 * cruises and brakes to stop exactly at each stop, waits, then goes on.
 * Positions are computed from time rather than stepped, so they are exact
 * and frame-rate independent, and a trip can follow a timetable.
 */
export class Trip {
  readonly stops: readonly number[];
  private readonly legs: Leg[] = [];
  private readonly pattern: NonNullable<TripOptions["pattern"]>;
  private readonly accel: number;
  private readonly decel: number;
  private readonly length: number;
  /** Duration of one full cycle of the pattern in seconds (Infinity for "once"). */
  readonly period: number;

  constructor({
    stops,
    speed = 20,
    acceleration = 1.2,
    deceleration = acceleration,
    dwell = 8,
    pattern = "shuttle",
    length,
  }: TripOptions) {
    if (stops.length < 2) throw new Error("A trip needs at least two stops");
    if (pattern === "loop" && !length) throw new Error('A "loop" trip needs the path length');
    this.stops = stops;
    this.pattern = pattern;
    this.accel = acceleration;
    this.decel = deceleration;
    this.length = length ?? 0;
    const order: [number, number][] = [];
    for (let i = 0; i < stops.length - 1; i++) order.push([i, i + 1]);
    if (pattern === "shuttle") for (let i = stops.length - 1; i > 0; i--) order.push([i, i - 1]);
    if (pattern === "loop") order.push([stops.length - 1, 0]);
    // Each leg starts with the dwell at its first stop.
    let time = 0;
    for (const [a, b] of order) {
      const from = stops[a];
      let to = stops[b];
      if (pattern === "loop" && b === 0) to = stops[0] + (length as number);
      const leg = this.profile(Math.abs(to - from), speed);
      const start = time + dwell;
      this.legs.push({ from, to, fromStop: a, toStop: b, start, ...leg, end: start + leg.total });
      time = start + leg.total;
    }
    this.period = pattern === "once" ? Number.POSITIVE_INFINITY : time;
  }

  // Trapezoidal speed profile covering `distance`. Short legs never reach `speed` and get a triangular one.
  private profile(distance: number, speed: number) {
    const a = this.accel;
    const b = this.decel;
    let peak = speed;
    if ((peak * peak) / (2 * a) + (peak * peak) / (2 * b) > distance) {
      peak = Math.sqrt((2 * distance * a * b) / (a + b));
    }
    const accelTime = peak / a;
    const decelTime = peak / b;
    const cruise = distance - (peak * peak) / (2 * a) - (peak * peak) / (2 * b);
    const cruiseTime = Math.max(0, cruise) / peak;
    return { accelTime, cruiseTime, decelTime, peak, total: accelTime + cruiseTime + decelTime };
  }

  // Distance covered and speed `t` seconds into a leg.
  private along(leg: Leg, t: number) {
    const { accelTime: ta, cruiseTime: tc, decelTime: td, peak } = leg;
    if (t <= ta) return { covered: 0.5 * this.accel * t * t, speed: this.accel * t };
    const accelDistance = 0.5 * peak * ta;
    if (t <= ta + tc) return { covered: accelDistance + peak * (t - ta), speed: peak };
    const u = Math.min(td, t - ta - tc);
    return {
      covered: accelDistance + peak * tc + peak * u - 0.5 * this.decel * u * u,
      speed: Math.max(0, peak - this.decel * u),
    };
  }

  /** The vehicle's state `time` seconds after the trip starts, which is at the first stop waiting to leave. */
  at(time: number): TripState {
    const lastLeg = this.legs[this.legs.length - 1];
    let t = Math.max(0, time);
    if (this.pattern === "once" && t >= lastLeg.end) {
      const stop = lastLeg.toStop;
      return {
        distance: this.stops[stop],
        speed: 0,
        direction: 1,
        stopped: true,
        stop,
        nextStop: stop,
        eta: 0,
      };
    }
    if (Number.isFinite(this.period)) t %= this.period;
    for (const leg of this.legs) {
      if (t >= leg.end) continue;
      const direction = leg.to >= leg.from ? 1 : -1;
      if (t < leg.start) {
        return {
          distance: this.wrap(leg.from),
          speed: 0,
          direction,
          stopped: true,
          stop: leg.fromStop,
          nextStop: leg.toStop,
          eta: leg.start - t,
        };
      }
      const { covered, speed } = this.along(leg, t - leg.start);
      return {
        distance: this.wrap(leg.from + direction * covered),
        speed,
        direction,
        stopped: false,
        stop: leg.fromStop,
        nextStop: leg.toStop,
        eta: leg.end - t,
      };
    }
    /* c8 ignore next 2 -- t is always inside a leg after the modulo */
    return this.at(0);
  }

  // On a loop, distances past the end of the path wrap to the start.
  private wrap(distance: number) {
    if (this.pattern !== "loop") return distance;
    const length = this.length;
    return ((distance % length) + length) % length;
  }
}
