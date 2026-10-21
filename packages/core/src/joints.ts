import * as THREE from "three/webgpu";

/**
 * How a part moves: turning around a hinge, as for doors and lids, or
 * sliding along a line, as for drawers. Driven by a value from 0 (closed)
 * to 1 (open).
 */
export interface JointSpec {
  /**
   * The hinge position. Either words naming an edge or corner of the parts'
   * bounds ("front", "back", "top", "bottom", "left", "right", combined as in
   * "bottom-back"), or an exact point in the first part's parent space. The
   * model faces +z, so front is +z, top is +y and left is +x. Default "center".
   */
  hinge?: string | readonly [number, number, number];
  /** Rotation or slide axis in the first part's parent space (default "y"). */
  axis?: "x" | "y" | "z" | readonly [number, number, number];
  /** Angles in degrees at 0 and at 1 (default [0, 90]). */
  range?: readonly [number, number];
  /** Distances along the axis at 0 and at 1. When set, the parts slide instead of turning. */
  slide?: readonly [number, number];
}

const WORDS: Record<string, [axis: 0 | 1 | 2, side: "min" | "max"]> = {
  front: [2, "max"],
  back: [2, "min"],
  top: [1, "max"],
  bottom: [1, "min"],
  left: [0, "max"],
  right: [0, "min"],
};

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** The point of `box` described by hinge `words` such as "bottom-back". Axes not named use the centre. */
export const hingePoint = (box: THREE.Box3, words: string) => {
  const point = box.getCenter(new THREE.Vector3());
  for (const word of words
    .toLowerCase()
    .split(/[-\s]+/)
    .filter(Boolean)) {
    if (word === "center" || word === "centre") continue;
    const rule = WORDS[word];
    if (!rule)
      throw new Error(`Unknown hinge word "${word}": use front, back, top, bottom, left, right or center`);
    const [axis, side] = rule;
    point.setComponent(axis, box[side].getComponent(axis));
  }
  return point;
};

interface Rest {
  part: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  pivot: THREE.Vector3;
  axis: THREE.Vector3;
}

const turn = new THREE.Quaternion();
const offset = new THREE.Vector3();

/**
 * Moves parts around a shared hinge or along a shared line. The hinge is
 * computed once from the parts' bounds at rest, and set(t) places the parts
 * for t from 0 to 1 relative to their rest pose.
 */
export class Joint {
  private readonly rest: Rest[];
  private readonly spec: JointSpec;
  private value = 0;

  constructor(parts: readonly THREE.Object3D[], spec: JointSpec = {}) {
    this.spec = spec;
    const box = new THREE.Box3();
    for (const part of parts) {
      part.updateWorldMatrix(true, true);
      box.expandByObject(part, true);
    }
    // Parts without geometry contribute their positions instead.
    if (box.isEmpty())
      for (const part of parts) box.expandByPoint(part.getWorldPosition(new THREE.Vector3()));
    const reference = parts[0]?.parent ?? null;
    const toLocal = new THREE.Matrix4();
    if (reference) toLocal.copy(reference.matrixWorld).invert();
    const localBox = box.isEmpty()
      ? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
      : box.applyMatrix4(toLocal);
    const hinge = spec.hinge ?? "center";
    const pivotInReference =
      typeof hinge === "string" ? hingePoint(localBox, hinge) : new THREE.Vector3(...hinge);
    const axisInReference =
      typeof spec.axis === "object"
        ? new THREE.Vector3(...spec.axis).normalize()
        : AXES[spec.axis ?? "y"].clone();
    // The hinge and axis are given in the first part's parent space. Convert them for parts with other parents.
    const pivotWorld = reference
      ? pivotInReference.clone().applyMatrix4(reference.matrixWorld)
      : pivotInReference;
    const axisWorld = reference
      ? axisInReference.clone().transformDirection(reference.matrixWorld)
      : axisInReference.clone();
    this.rest = parts.map((part) => {
      const parent = part.parent;
      const inverse = parent ? new THREE.Matrix4().copy(parent.matrixWorld).invert() : new THREE.Matrix4();
      return {
        part,
        position: part.position.clone(),
        quaternion: part.quaternion.clone(),
        pivot: pivotWorld.clone().applyMatrix4(inverse),
        axis: axisWorld.clone().transformDirection(inverse),
      };
    });
  }

  /** The value last passed to set (0 at rest). */
  get current() {
    return this.value;
  }

  /** Places the parts for `t`, where 0 is rest and 1 is fully open. Values outside 0 to 1 extrapolate. */
  set(t: number) {
    this.value = t;
    const { range = [0, 90], slide } = this.spec;
    for (const { part, position, quaternion, pivot, axis } of this.rest) {
      if (slide) {
        const distance = slide[0] + (slide[1] - slide[0]) * t;
        part.position.copy(position).addScaledVector(axis, distance);
      } else {
        const angle = THREE.MathUtils.degToRad(range[0] + (range[1] - range[0]) * t);
        turn.setFromAxisAngle(axis, angle);
        offset.copy(position).sub(pivot).applyQuaternion(turn);
        part.position.copy(pivot).add(offset);
        part.quaternion.copy(turn).multiply(quaternion);
      }
      part.updateMatrix();
    }
  }

  /** Puts the parts back at rest. */
  reset() {
    for (const { part, position, quaternion } of this.rest) {
      part.position.copy(position);
      part.quaternion.copy(quaternion);
      part.updateMatrix();
    }
    this.value = 0;
  }
}
