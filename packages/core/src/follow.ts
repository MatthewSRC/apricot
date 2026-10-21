import * as THREE from "three/webgpu";

export interface FollowOptions {
  /** Distance behind the target in metres (default 6). */
  distance?: number;
  /** Height above the target in metres (default 2.6). */
  height?: number;
  /** The look-at point as [distance ahead of the target, height above it] (default [3, 0.6]). */
  lookAhead?: readonly [number, number];
  /** How quickly the camera catches up, per second (default 4). Higher values follow more tightly. */
  stiffness?: number;
}

const desired = new THREE.Vector3();
const forward = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const worldPosition = new THREE.Vector3();
const worldQuaternion = new THREE.Quaternion();
const worldScale = new THREE.Vector3();

/**
 * A chase camera. It eases the camera towards a point behind and above the
 * target, where behind is opposite the target's +z, and looks a little
 * ahead of it. Easing is frame-rate independent.
 */
export class FollowRig {
  private readonly options: Required<FollowOptions>;
  private readonly look = new THREE.Vector3();
  private placed = false;

  constructor(options: FollowOptions = {}) {
    this.options = { distance: 6, height: 2.6, lookAhead: [3, 0.6], stiffness: 4, ...options };
  }

  /** Jumps to the resting position on the next update instead of easing there. */
  snap() {
    this.placed = false;
  }

  /** Moves `camera` towards its position for `target` over `delta` seconds. Returns true while it is still catching up. */
  update(camera: THREE.Camera, target: THREE.Object3D, delta: number) {
    const { distance, height, lookAhead, stiffness } = this.options;
    target.updateWorldMatrix(true, false);
    target.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
    // Forward on the ground plane only, so the camera does not pitch with bumps.
    forward.set(0, 0, 1).applyQuaternion(worldQuaternion).setY(0);
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    forward.normalize();
    desired.copy(worldPosition).addScaledVector(forward, -distance);
    desired.y += height;
    lookTarget.copy(worldPosition).addScaledVector(forward, lookAhead[0]);
    lookTarget.y += lookAhead[1];

    if (!this.placed) {
      camera.position.copy(desired);
      this.look.copy(lookTarget);
      this.placed = true;
    } else {
      const t = 1 - Math.exp(-stiffness * Math.max(0, delta));
      camera.position.lerp(desired, t);
      this.look.lerp(lookTarget, t);
    }
    camera.lookAt(this.look);
    camera.updateMatrixWorld();
    return (
      camera.position.distanceToSquared(desired) > 1e-6 || this.look.distanceToSquared(lookTarget) > 1e-6
    );
  }
}
