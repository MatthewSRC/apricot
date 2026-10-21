import * as THREE from "three/webgpu";

/** What a tap hit: the nearest mesh under the finger. */
export interface PressHit {
  /** The mesh that was hit. */
  mesh: THREE.Mesh;
  /** The material of the face that was hit. */
  material: THREE.Material | undefined;
  /** Index of that material in the mesh (0 for single-material meshes). */
  materialIndex: number;
  /** World-space point that was hit. */
  point: THREE.Vector3;
  /** Distance from the camera. */
  distance: number;
  /** The instance that was hit, for an instanced mesh (<Instances>, InstanceSet). */
  instanceId?: number;
}

export type PressHandler = (hit: PressHit) => void;

/**
 * Turns taps on the canvas into hits on objects. Objects register a handler;
 * a tap finds the nearest mesh among all registered objects and calls the
 * handler of the object that owns it. Raycasts only on a tap, never per frame.
 */
export class PressRouter {
  private readonly targets = new Map<THREE.Object3D, Set<PressHandler>>();
  private readonly misses = new Set<() => void>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  /** Calls `handler` when a tap hits `object` (or anything under it). Returns the remover. */
  add(object: THREE.Object3D, handler: PressHandler) {
    let handlers = this.targets.get(object);
    if (!handlers) {
      handlers = new Set();
      this.targets.set(object, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0 && this.targets.get(object) === handlers) this.targets.delete(object);
    };
  }

  /**
   * Calls `handler` when a tap hits nothing that listens, for example to put
   * down a picked-up object or close a panel. Returns the remover.
   */
  addMiss(handler: () => void) {
    this.misses.add(handler);
    return () => {
      this.misses.delete(handler);
    };
  }

  /** True when something listens for taps. */
  get active() {
    return this.targets.size > 0 || this.misses.size > 0;
  }

  /**
   * The nearest hit at view point (x, y), in points from the top-left of a
   * view `width` × `height`, among `objects` (default: every registered one).
   */
  hitTest(
    camera: THREE.Camera,
    x: number,
    y: number,
    width: number,
    height: number,
    objects: readonly THREE.Object3D[] = [...this.targets.keys()],
  ): PressHit | null {
    if (width <= 0 || height <= 0 || objects.length === 0) return null;
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    camera.updateMatrixWorld();
    // Objects moved since the last frame are hit where they are now.
    for (const object of objects) object.updateWorldMatrix(true, true);
    this.raycaster.setFromCamera(this.pointer, camera);
    const hits = this.raycaster.intersectObjects(objects as THREE.Object3D[], true);
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.isMesh || !isVisible(mesh)) continue;
      const materialIndex = Array.isArray(mesh.material) ? (hit.face?.materialIndex ?? 0) : 0;
      const material = Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
      return {
        mesh,
        material,
        materialIndex,
        point: hit.point,
        distance: hit.distance,
        ...(hit.instanceId === undefined ? {} : { instanceId: hit.instanceId }),
      };
    }
    return null;
  }

  /** Handles a tap at (x, y): calls the handlers of the innermost object owning the nearest mesh. Returns the hit. */
  press(camera: THREE.Camera, x: number, y: number, width: number, height: number) {
    if (!this.active) return null;
    const hit = this.hitTest(camera, x, y, width, height);
    if (hit) {
      for (let o: THREE.Object3D | null = hit.mesh; o; o = o.parent) {
        const handlers = this.targets.get(o);
        if (handlers) {
          for (const handler of [...handlers]) handler(hit);
          return hit;
        }
      }
    }
    for (const handler of [...this.misses]) handler();
    return hit;
  }
}

const isVisible = (object: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
};
