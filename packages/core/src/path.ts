import * as THREE from "three/webgpu";
import type { Vec3 } from "./spin";

export interface PathOptions {
  /** Joins the end back to the start, as for a loop line or a race track. */
  closed?: boolean;
  /** Catmull-Rom tension between 0 and 1 (default 0.5). */
  tension?: number;
}

const forward = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4();
const origin = new THREE.Vector3();

/**
 * A smooth curve through points, addressed by distance along it in metres
 * rather than by curve parameter. `pointAt(120)` is 120 m from the start
 * however the points are spaced. Use it for tracks, roads and flight paths.
 */
export class Path {
  readonly curve: THREE.CatmullRomCurve3;
  readonly closed: boolean;
  /** Total length in metres. */
  readonly length: number;

  constructor(points: readonly Vec3[], { closed = false, tension = 0.5 }: PathOptions = {}) {
    if (points.length < 2) throw new Error("A path needs at least two points");
    this.closed = closed;
    this.curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      closed,
      "centripetal",
      tension,
    );
    // Enough divisions for distances accurate to a few centimetres on long paths.
    this.curve.arcLengthDivisions = Math.max(200, points.length * 50);
    this.length = this.curve.getLength();
  }

  /** Maps `distance` onto the path: wrapped for closed paths, clamped to the ends otherwise. */
  clamp(distance: number) {
    if (this.closed) return ((distance % this.length) + this.length) % this.length;
    return Math.min(this.length, Math.max(0, distance));
  }

  /** The point `distance` along the path. */
  pointAt(distance: number, target = new THREE.Vector3()) {
    return this.curve.getPointAt(this.clamp(distance) / this.length, target);
  }

  /** The direction of travel at `distance` (unit length). */
  tangentAt(distance: number, target = new THREE.Vector3()) {
    return this.curve.getTangentAt(this.clamp(distance) / this.length, target);
  }

  /**
   * Places `object` at `distance`, facing along the path with +z forward and
   * +y up. A `direction` of -1 faces it backwards.
   */
  place(object: THREE.Object3D, distance: number, direction: 1 | -1 = 1) {
    this.pointAt(distance, object.position);
    this.tangentAt(distance, forward).multiplyScalar(direction);
    // lookAt aims -z at the target; aim +z along the path instead.
    matrix.lookAt(origin, forward.negate(), up);
    object.quaternion.setFromRotationMatrix(matrix);
  }

  /** Distances every `spacing` metres along the path from `start`, for placing posts or lamps. */
  every(spacing: number, start = 0) {
    if (spacing <= 0) throw new Error("spacing must be positive");
    const out: number[] = [];
    for (let d = start; d <= this.length + 1e-6; d += spacing) out.push(d);
    return out;
  }

  /** The distance along the path of the point closest to `point`, found by sampling `samples` times. */
  distanceTo(point: Vec3, samples = 400) {
    const p = new THREE.Vector3(...point);
    const scratch = new THREE.Vector3();
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= samples; i++) {
      const d = (i / samples) * this.length;
      const gap = this.pointAt(d, scratch).distanceToSquared(p);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = d;
      }
    }
    return best;
  }
}
