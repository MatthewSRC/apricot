export interface VehicleOptions {
  /** Top speed forwards, in units / s (default 12). */
  maxSpeed?: number;
  /** Top speed in reverse, in units / s (default 4). */
  maxReverse?: number;
  /** Acceleration at full throttle, in units / s² (default 9). */
  acceleration?: number;
  /** Deceleration when the throttle opposes the motion, in units / s² (default 20). */
  braking?: number;
  /** Deceleration with no throttle, in units / s² (default 3). */
  drag?: number;
  /** Distance between the axles. A shorter wheelbase turns tighter (default 1.4). */
  wheelBase?: number;
  /** Largest front-wheel angle in radians (default 0.6). */
  maxSteer?: number;
  /** Rate at which the wheels approach the requested angle, per second (default 8). */
  steerSpeed?: number;
  /** Wheel radius, used for `wheelSpin` (default 0.3). */
  wheelRadius?: number;
  /** Keeps the car inside this ground area: [minX, minZ, maxX, maxZ]. */
  bounds?: readonly [number, number, number, number];
}

export interface VehicleInput {
  /** -1 (reverse / brake) to 1 (full throttle). */
  throttle: number;
  /** -1 (left) to 1 (right). */
  steer: number;
}

export interface VehicleState {
  x: number;
  z: number;
  /** Radians about +y. 0 faces +z. */
  heading: number;
  /** Signed speed along the heading in units / s. */
  speed: number;
  /** Current front-wheel angle in radians. Positive steers right. */
  steer: number;
  /** Accumulated wheel rotation in radians. */
  wheelSpin: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * An arcade car using a bicycle model, with throttle, brakes, drag and
 * steering that narrows with speed. It does not skid or tip over. It moves
 * on the ground plane (x, z), and heading 0 faces +z.
 */
export class ArcadeVehicle {
  readonly state: VehicleState;
  private readonly options: Required<Omit<VehicleOptions, "bounds">> & Pick<VehicleOptions, "bounds">;

  constructor(options: VehicleOptions = {}, start: Partial<Pick<VehicleState, "x" | "z" | "heading">> = {}) {
    this.options = {
      maxSpeed: 12,
      maxReverse: 4,
      acceleration: 9,
      braking: 20,
      drag: 3,
      wheelBase: 1.4,
      maxSteer: 0.6,
      steerSpeed: 8,
      wheelRadius: 0.3,
      ...options,
    };
    this.state = {
      x: start.x ?? 0,
      z: start.z ?? 0,
      heading: start.heading ?? 0,
      speed: 0,
      steer: 0,
      wheelSpin: 0,
    };
  }

  /** Advances by `delta` seconds. Returns true while the car or its wheels still move. */
  step(delta: number, input: VehicleInput) {
    const o = this.options;
    const s = this.state;
    if (delta <= 0) return s.speed !== 0;
    const throttle = clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1);
    const steerInput = clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1);

    // Throttle in the direction of motion accelerates, throttle against it brakes, and none coasts.
    if (throttle !== 0 && (s.speed === 0 || Math.sign(throttle) === Math.sign(s.speed))) {
      s.speed += throttle * o.acceleration * delta;
    } else if (throttle !== 0) {
      s.speed = moveTowards(s.speed, 0, Math.abs(throttle) * o.braking * delta);
    } else {
      s.speed = moveTowards(s.speed, 0, o.drag * delta);
    }
    s.speed = clamp(s.speed, -o.maxReverse, o.maxSpeed);

    // Steering eases towards the input, and its range narrows at speed so the car stays controllable.
    const target = steerInput * o.maxSteer * (1 / (1 + Math.abs(s.speed) / o.maxSpeed));
    const steerStep = 1 - Math.exp(-o.steerSpeed * delta);
    s.steer += (target - s.steer) * steerStep;
    if (Math.abs(s.steer) < 1e-4 && steerInput === 0) s.steer = 0;

    // Bicycle model: the heading changes by (distance / wheelBase) * tan(steer). Positive steer turns clockwise seen from above.
    const distance = s.speed * delta;
    s.heading -= (distance / o.wheelBase) * Math.tan(s.steer);
    s.x += Math.sin(s.heading) * distance;
    s.z += Math.cos(s.heading) * distance;
    s.wheelSpin += distance / o.wheelRadius;

    if (o.bounds) {
      const [minX, minZ, maxX, maxZ] = o.bounds;
      const x = clamp(s.x, minX, maxX);
      const z = clamp(s.z, minZ, maxZ);
      // Hitting the edge stops the car.
      if (x !== s.x || z !== s.z) s.speed = 0;
      s.x = x;
      s.z = z;
    }
    return s.speed !== 0 || s.steer !== 0;
  }
}

const moveTowards = (value: number, target: number, maxStep: number) =>
  Math.abs(target - value) <= maxStep ? target : value + Math.sign(target - value) * maxStep;
