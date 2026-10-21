export interface Bounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface SphereWorldOptions {
  /** The maximum number of bodies. */
  capacity: number;
  /** The box the bodies stay inside. Its floor is at min[1]. */
  bounds: Bounds;
  /** Acceleration in world units / s² (default [0, -15, 0]). */
  gravity?: readonly [number, number, number];
  /** Friction with the floor (default 0.6). Walls are frictionless so bodies do not stick to them. */
  friction?: number;
  /**
   * Friction between bodies (default 0.15). Spin is visual only and does not
   * affect contacts, so high values make bodies balance on each other in
   * towers instead of heaping up.
   */
  bodyFriction?: number;
  /** Linear damping per second (default 0.05). */
  damping?: number;
  /**
   * Extra damping per second while a body touches something (default 4).
   * It acts as rolling resistance so bodies come to rest.
   */
  contactDamping?: number;
  /** A body slower than this, in units / s, counts as resting (default 0.12). */
  restSpeed?: number;
  /** Seconds every body must rest before the world sleeps (default 0.4). */
  settleTime?: number;
  /**
   * Speed limit in units / s (default 40). It stops bodies created
   * overlapping from being launched when they are pushed apart.
   */
  maxSpeed?: number;
  /** Contact solver passes per substep (default 2). More passes keep deep piles tighter. */
  iterations?: number;
  /** Longest simulation substep in seconds (default 1/120). */
  maxSubstep?: number;
}

export interface BodyInit {
  position: readonly [number, number, number];
  radius: number;
  velocity?: readonly [number, number, number];
  /** Initial orientation as a quaternion [x, y, z, w]. */
  rotation?: readonly [number, number, number, number];
  angularVelocity?: readonly [number, number, number];
}

const MAX_SUBSTEPS = 8;

/**
 * A small rigid-sphere simulation for piles of objects, with gravity, a
 * bounding box, sphere contacts with friction, rolling and sleeping. It uses
 * position-based dynamics with substeps and is sized for tens to a few
 * hundred bodies. Body state is kept in typed arrays.
 */
export class SphereWorld {
  readonly capacity: number;
  /** Positions, 3 per body. */
  readonly position: Float64Array;
  /** Orientations as quaternions, 4 per body. */
  readonly rotation: Float64Array;
  readonly radius: Float64Array;
  private readonly velocity: Float64Array;
  private readonly spin: Float64Array;
  private readonly previous: Float64Array;
  private readonly normals: Float64Array;
  private readonly inverseMass: Float64Array;
  private readonly order: Int32Array;
  private bounds: Bounds;
  private readonly gravity: readonly [number, number, number];
  private readonly friction: number;
  private readonly bodyFriction: number;
  private readonly damping: number;
  private readonly contactDamping: number;
  private readonly restSpeed: number;
  private readonly settleTime: number;
  private readonly maxSubstep: number;
  private readonly iterations: number;
  private readonly maxSpeed: number;
  private maxRadius = 0;
  private restingFor = 0;
  private count_ = 0;
  private asleep = false;

  constructor(options: SphereWorldOptions) {
    const n = Math.max(0, Math.floor(options.capacity));
    this.capacity = n;
    this.position = new Float64Array(n * 3);
    this.rotation = new Float64Array(n * 4);
    this.radius = new Float64Array(n);
    this.velocity = new Float64Array(n * 3);
    this.spin = new Float64Array(n * 3);
    this.previous = new Float64Array(n * 3);
    this.normals = new Float64Array(n * 3);
    this.inverseMass = new Float64Array(n);
    this.order = new Int32Array(n);
    this.bounds = options.bounds;
    this.gravity = options.gravity ?? [0, -15, 0];
    this.friction = options.friction ?? 0.6;
    this.bodyFriction = options.bodyFriction ?? 0.15;
    this.damping = options.damping ?? 0.05;
    this.contactDamping = options.contactDamping ?? 4;
    this.restSpeed = options.restSpeed ?? 0.12;
    this.settleTime = options.settleTime ?? 0.4;
    this.maxSubstep = options.maxSubstep ?? 1 / 120;
    this.iterations = Math.max(1, Math.floor(options.iterations ?? 2));
    this.maxSpeed = options.maxSpeed ?? 40;
  }

  /** Bodies added so far. */
  get count() {
    return this.count_;
  }

  /** True once every body has rested for `settleTime`. step() then does no work. */
  get isAsleep() {
    return this.asleep;
  }

  /** Adds a body and wakes the world. Returns its index, or -1 when full. */
  add({
    position,
    radius,
    velocity = [0, 0, 0],
    rotation = [0, 0, 0, 1],
    angularVelocity = [0, 0, 0],
  }: BodyInit) {
    if (this.count_ >= this.capacity) return -1;
    const i = this.count_++;
    this.position.set(position, i * 3);
    this.velocity.set(velocity, i * 3);
    this.rotation.set(rotation, i * 4);
    this.spin.set(angularVelocity, i * 3);
    this.radius[i] = radius;
    // Mass is proportional to volume, so large bodies push small ones aside.
    this.inverseMass[i] = 1 / (radius * radius * radius);
    this.order[i] = i;
    this.maxRadius = Math.max(this.maxRadius, radius);
    this.wake();
    return i;
  }

  /**
   * True when a sphere at `position` with `radius` would overlap no body.
   * Spawners use it to pick a free spot.
   */
  isFree(position: readonly [number, number, number], radius: number) {
    const p = this.position;
    for (let i = 0; i < this.count_; i++) {
      const touch = radius + this.radius[i];
      const dx = p[i * 3] - position[0];
      const dy = p[i * 3 + 1] - position[1];
      const dz = p[i * 3 + 2] - position[2];
      if (dx * dx + dy * dy + dz * dz < touch * touch) return false;
    }
    return true;
  }

  /** Changes the box (for example after the screen rotates) and wakes the world. */
  setBounds(bounds: Bounds) {
    this.bounds = bounds;
    this.wake();
  }

  /** Wakes the world so the next step simulates again. */
  wake() {
    this.asleep = false;
    this.restingFor = 0;
  }

  /** Advances the simulation. Returns true while anything still moves. */
  step(delta: number) {
    if (this.asleep || delta <= 0 || this.count_ === 0) return !this.asleep && this.count_ > 0;
    const substeps = Math.min(MAX_SUBSTEPS, Math.ceil(delta / this.maxSubstep));
    const h = delta / substeps;
    let fastest = 0;
    for (let s = 0; s < substeps; s++) fastest = this.substep(h);
    if (fastest < this.restSpeed) this.restingFor += delta;
    else this.restingFor = 0;
    if (this.restingFor >= this.settleTime) {
      this.asleep = true;
      this.velocity.fill(0);
      this.spin.fill(0);
    }
    return !this.asleep;
  }

  // One substep. Returns the fastest body's speed.
  private substep(h: number) {
    const { position: p, previous, velocity: v, normals, count_: n } = this;
    const [gx, gy, gz] = this.gravity;
    for (let i = 0; i < n * 3; i += 3) {
      previous[i] = p[i];
      previous[i + 1] = p[i + 1];
      previous[i + 2] = p[i + 2];
      v[i] += gx * h;
      v[i + 1] += gy * h;
      v[i + 2] += gz * h;
      p[i] += v[i] * h;
      p[i + 1] += v[i + 1] * h;
      p[i + 2] += v[i + 2] * h;
    }
    normals.fill(0, 0, n * 3);
    for (let pass = 0; pass < this.iterations; pass++) {
      this.solveContacts();
      this.solveBounds();
    }

    const free = Math.max(0, 1 - this.damping * h);
    const touching = Math.max(0, 1 - (this.damping + this.contactDamping) * h);
    let fastest = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const keep = normals[k] !== 0 || normals[k + 1] !== 0 || normals[k + 2] !== 0 ? touching : free;
      v[k] = ((p[k] - previous[k]) / h) * keep;
      v[k + 1] = ((p[k + 1] - previous[k + 1]) / h) * keep;
      v[k + 2] = ((p[k + 2] - previous[k + 2]) / h) * keep;
      const speed = Math.hypot(v[k], v[k + 1], v[k + 2]);
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed;
        v[k] *= scale;
        v[k + 1] *= scale;
        v[k + 2] *= scale;
      }
      fastest = Math.max(fastest, Math.min(speed, this.maxSpeed));
      this.updateSpin(i, h);
    }
    return fastest;
  }

  private solveContacts() {
    const { position: p, radius: r, inverseMass: w, order, count_: n } = this;
    // Sort by x, then test only pairs closer along x than the largest possible contact distance.
    // Insertion sort is fast here because the order barely changes between substeps.
    for (let a = 1; a < n; a++) {
      const id = order[a];
      const x = p[id * 3];
      let b = a - 1;
      while (b >= 0 && p[order[b] * 3] > x) {
        order[b + 1] = order[b];
        b--;
      }
      order[b + 1] = id;
    }
    for (let a = 0; a < n; a++) {
      const i = order[a];
      const reach = r[i] + this.maxRadius;
      for (let b = a + 1; b < n; b++) {
        const j = order[b];
        const dx = p[j * 3] - p[i * 3];
        if (dx > reach) break;
        const dy = p[j * 3 + 1] - p[i * 3 + 1];
        const dz = p[j * 3 + 2] - p[i * 3 + 2];
        const touch = r[i] + r[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= touch * touch) continue;
        const d = Math.sqrt(d2);
        // Push coincident centres apart vertically.
        const nx = d > 1e-9 ? dx / d : 0;
        const ny = d > 1e-9 ? dy / d : 1;
        const nz = d > 1e-9 ? dz / d : 0;
        const depth = touch - d;
        const wi = w[i] / (w[i] + w[j]);
        const wj = w[j] / (w[i] + w[j]);
        this.move(i, -nx * depth * wi, -ny * depth * wi, -nz * depth * wi);
        this.move(j, nx * depth * wj, ny * depth * wj, nz * depth * wj);
        this.applyFriction(i, j, nx, ny, nz, depth, wi, wj);
        this.addNormal(i, -nx, -ny, -nz);
        this.addNormal(j, nx, ny, nz);
      }
    }
  }

  // Coulomb-style friction on the relative motion during this substep.
  private applyFriction(
    i: number,
    j: number,
    nx: number,
    ny: number,
    nz: number,
    depth: number,
    wi: number,
    wj: number,
  ) {
    const { position: p, previous: q } = this;
    let rx = p[i * 3] - q[i * 3];
    let ry = p[i * 3 + 1] - q[i * 3 + 1];
    let rz = p[i * 3 + 2] - q[i * 3 + 2];
    if (j >= 0) {
      rx -= p[j * 3] - q[j * 3];
      ry -= p[j * 3 + 1] - q[j * 3 + 1];
      rz -= p[j * 3 + 2] - q[j * 3 + 2];
    }
    const along = rx * nx + ry * ny + rz * nz;
    const tx = rx - along * nx;
    const ty = ry - along * ny;
    const tz = rz - along * nz;
    const slide = Math.hypot(tx, ty, tz);
    if (slide < 1e-12) return;
    const limit = (j >= 0 ? this.bodyFriction : this.friction) * depth;
    const f = slide <= limit ? 1 : limit / slide;
    this.move(i, -tx * f * wi, -ty * f * wi, -tz * f * wi);
    if (j >= 0) this.move(j, tx * f * wj, ty * f * wj, tz * f * wj);
  }

  private solveBounds() {
    const { position: p, radius: r, count_: n } = this;
    const { min, max } = this.bounds;
    for (let i = 0; i < n; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const k = i * 3 + axis;
        const low = min[axis] + r[i];
        const high = max[axis] - r[i];
        // A box narrower than the body keeps it centred.
        if (low > high) {
          p[k] = (low + high) / 2;
          continue;
        }
        if (p[k] < low) {
          const depth = low - p[k];
          p[k] = low;
          // Only the floor has friction and makes bodies roll. Walls just push.
          if (axis === 1) {
            this.applyFriction(i, -1, 0, 1, 0, depth, 1, 0);
            this.addNormal(i, 0, 1, 0);
          }
        } else if (p[k] > high) {
          p[k] = high;
        }
      }
    }
  }

  // Bodies in contact roll along what they touch. Free bodies keep their spin.
  private updateSpin(i: number, h: number) {
    const { normals: c, velocity: v, spin: s, rotation: q } = this;
    const k = i * 3;
    const length = Math.hypot(c[k], c[k + 1], c[k + 2]);
    if (length > 1e-9) {
      const nx = c[k] / length;
      const ny = c[k + 1] / length;
      const nz = c[k + 2] / length;
      // Rolling without slipping: spin = n × v / r.
      const inv = 1 / this.radius[i];
      s[k] = (ny * v[k + 2] - nz * v[k + 1]) * inv;
      s[k + 1] = (nz * v[k] - nx * v[k + 2]) * inv;
      s[k + 2] = (nx * v[k + 1] - ny * v[k]) * inv;
    }
    const wx = s[k];
    const wy = s[k + 1];
    const wz = s[k + 2];
    if (wx === 0 && wy === 0 && wz === 0) return;
    // q += ½ (ω, 0) q h, then normalise.
    const o = i * 4;
    const x = q[o];
    const y = q[o + 1];
    const z = q[o + 2];
    const qw = q[o + 3];
    const half = h / 2;
    const nx = x + half * (wx * qw + wy * z - wz * y);
    const ny = y + half * (wy * qw + wz * x - wx * z);
    const nz = z + half * (wz * qw + wx * y - wy * x);
    const nw = qw - half * (wx * x + wy * y + wz * z);
    const norm = 1 / Math.hypot(nx, ny, nz, nw);
    q[o] = nx * norm;
    q[o + 1] = ny * norm;
    q[o + 2] = nz * norm;
    q[o + 3] = nw * norm;
  }

  private move(i: number, x: number, y: number, z: number) {
    const k = i * 3;
    this.position[k] += x;
    this.position[k + 1] += y;
    this.position[k + 2] += z;
  }

  private addNormal(i: number, x: number, y: number, z: number) {
    const k = i * 3;
    this.normals[k] += x;
    this.normals[k + 1] += y;
    this.normals[k + 2] += z;
  }
}
