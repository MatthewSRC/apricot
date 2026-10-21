import type * as THREE from "three/webgpu";

// Longest time a new object is left out of frames while its shaders compile (ms).
const NEW_AT_MOST = 1500;

/**
 * Objects left out of frames: new ones whose shaders are still compiling,
 * and ones held back with ApricotScene.holdBack.
 */
export class FrameExclusions {
  // New objects, with the time each was added.
  private readonly fresh = new Map<THREE.Object3D, number>();
  // Held-back objects, with the number of holds on each.
  private readonly held = new Map<THREE.Object3D, number>();

  /** Leaves the new `object`, added at time `now`, out of frames until revealed. */
  keepNew(object: THREE.Object3D, now: number) {
    this.fresh.set(object, now);
  }

  /** The new objects left out so far. */
  newObjects() {
    return [...this.fresh.keys()];
  }

  /** The number of new objects left out. */
  get newCount() {
    return this.fresh.size;
  }

  /** Lets `objects` back into frames. */
  reveal(objects: readonly THREE.Object3D[]) {
    for (const object of objects) this.fresh.delete(object);
  }

  /** Adds a hold on `object`. */
  hold(object: THREE.Object3D) {
    this.held.set(object, (this.held.get(object) ?? 0) + 1);
  }

  /** Removes a hold on `object`. */
  release(object: THREE.Object3D) {
    const holds = (this.held.get(object) ?? 1) - 1;
    if (holds > 0) this.held.set(object, holds);
    else this.held.delete(object);
  }

  /** Whether `object` or one of its ancestors is left out. */
  excludes(object: THREE.Object3D) {
    if (this.fresh.size === 0 && this.held.size === 0) return false;
    for (let o: THREE.Object3D | null = object; o; o = o.parent)
      if (this.fresh.has(o) || this.held.has(o)) return true;
    return false;
  }

  /**
   * Hides the excluded objects for one frame. New objects older than 1.5 s
   * are no longer excluded. Returns a function that shows them again, or
   * null when nothing is excluded.
   */
  hideForFrame(now: number) {
    if (this.fresh.size === 0 && this.held.size === 0) return null;
    const hidden: THREE.Object3D[] = [];
    for (const [object, since] of this.fresh) {
      if (now - since > NEW_AT_MOST) this.fresh.delete(object);
      else if (object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    }
    for (const object of this.held.keys())
      if (object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    return () => {
      for (const object of hidden) object.visible = true;
    };
  }
}
