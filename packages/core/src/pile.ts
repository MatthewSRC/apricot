import * as THREE from "three/webgpu";
import { type Bounds, SphereWorld, type SphereWorldOptions } from "./physics";
import { seededRandom } from "./random";

export interface PileItem {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Collision radius at scale 1. */
  radius: number;
  /** Base scale (default 1). */
  scale?: number;
}

export interface PileOptions {
  /** The kinds of object to drop. Each object is a random kind, and each kind is drawn in one call. */
  items: readonly PileItem[];
  /** How many objects to drop in total. */
  count: number;
  /** Seconds over which they drop (default 5). */
  duration?: number;
  /** The area to fill. Objects appear above its top and pile up on its floor. */
  bounds: Bounds;
  /** Range of random size factors applied to each item's scale (default [0.9, 1.1]). */
  scale?: readonly [number, number];
  /** Downward speed when objects appear (default 2). */
  speed?: number;
  /** Largest initial tumble in radians per second (default 4). */
  spin?: number;
  seed?: number;
  physics?: Omit<SphereWorldOptions, "capacity" | "bounds">;
}

interface Kind {
  item: PileItem;
  mesh: THREE.InstancedMesh;
}

/** A uniformly distributed random rotation as [x, y, z, w] (Shoemake's method). */
const randomQuaternion = (random: () => number): [number, number, number, number] => {
  const u = random();
  const a = 2 * Math.PI * random();
  const b = 2 * Math.PI * random();
  const s = Math.sqrt(1 - u);
  const t = Math.sqrt(u);
  return [s * Math.sin(a), s * Math.cos(a), t * Math.sin(b), t * Math.cos(b)];
};

/**
 * Objects that drop in one after another from above an area over `duration`
 * seconds and pile up on its floor. Simulated by a SphereWorld. Each kind of
 * object is one InstancedMesh, so a large pile needs only a few draw calls.
 */
export class Pile {
  readonly object = new THREE.Group();
  readonly world: SphereWorld;
  private readonly kinds: Kind[];
  private readonly bodyKind: Int32Array;
  private readonly bodySlot: Int32Array;
  private readonly bodyScale: Float64Array;
  private readonly random: () => number;
  private readonly spawnTimes: Float64Array;
  private readonly options: PileOptions;
  private bounds: Bounds;
  private elapsed = 0;
  private spawned = 0;

  constructor(options: PileOptions) {
    if (options.items.length === 0) throw new Error("Pile needs at least one item to drop");
    this.options = options;
    const count = Math.max(0, Math.floor(options.count));
    this.bounds = options.bounds;
    this.random = seededRandom(options.seed ?? 1);
    this.world = new SphereWorld({
      ...options.physics,
      capacity: count,
      bounds: this.worldBounds(options.bounds),
    });
    this.object.name = "Pile";
    this.kinds = options.items.map((item, i) => {
      const mesh = new THREE.InstancedMesh(item.geometry, item.material, Math.max(1, count));
      mesh.name = `Pile:${i}`;
      mesh.count = 0;
      // Instances spread over the whole area, so the mesh is never frustum culled as a whole.
      mesh.frustumCulled = false;
      this.object.add(mesh);
      return { item, mesh };
    });
    this.bodyKind = new Int32Array(count);
    this.bodySlot = new Int32Array(count);
    this.bodyScale = new Float64Array(count);
    // Evenly spaced drop times with some jitter.
    const duration = Math.max(0, options.duration ?? 5);
    this.spawnTimes = new Float64Array(count);
    for (let i = 0; i < count; i++) this.spawnTimes[i] = (duration * (i + this.random() * 0.8)) / count;
  }

  /** True once everything has dropped and come to rest. */
  get isSettled() {
    return this.spawned === this.world.capacity && !this.isMoving();
  }

  /** Objects dropped so far. */
  get count() {
    return this.spawned;
  }

  /** Changes the area, for example after the screen rotates. */
  setBounds(bounds: Bounds) {
    this.bounds = bounds;
    this.world.setBounds(this.worldBounds(bounds));
  }

  /** Advances by `delta` seconds. Returns true while anything still moves or is yet to drop. */
  step(delta: number) {
    this.elapsed += delta;
    let changed = false;
    while (this.spawned < this.world.capacity && this.spawnTimes[this.spawned] <= this.elapsed) {
      this.spawn();
      changed = true;
    }
    const moving = this.world.step(delta);
    if (moving || changed) this.sync();
    return this.spawned < this.world.capacity || moving;
  }

  /** Removes the instanced meshes from the scene and frees their buffers. The items' geometry and materials are not disposed. */
  dispose() {
    this.object.removeFromParent();
    for (const { mesh } of this.kinds) {
      mesh.removeFromParent();
      mesh.dispose();
    }
  }

  private isMoving() {
    return !this.world.isAsleep && this.world.count > 0;
  }

  // Extend the world's box far above the area so objects can enter from above.
  private worldBounds({ min, max }: Bounds): Bounds {
    return { min, max: [max[0], max[1] + 1e3, max[2]] };
  }

  private spawn() {
    const random = this.random;
    const kindIndex = Math.min(this.kinds.length - 1, Math.floor(random() * this.kinds.length));
    const { item, mesh } = this.kinds[kindIndex];
    const [low, high] = this.options.scale ?? [0.9, 1.1];
    const scale = (item.scale ?? 1) * (low + random() * (high - low));
    const radius = item.radius * scale;
    const { min, max } = this.bounds;
    const top = max[1];
    // Start just above the area. Try a few spots so it does not appear inside another object.
    let position: [number, number, number] = [0, 0, 0];
    for (let attempt = 0; attempt < 8; attempt++) {
      position = [
        min[0] + radius + random() * Math.max(0, max[0] - min[0] - 2 * radius),
        top + radius * (1.2 + attempt * 2.2) + random() * radius,
        min[2] + radius + random() * Math.max(0, max[2] - min[2] - 2 * radius),
      ];
      if (this.world.isFree(position, radius * 1.05)) break;
    }
    const spin = this.options.spin ?? 4;
    const index = this.world.add({
      position,
      radius,
      velocity: [0, -(this.options.speed ?? 2), 0],
      rotation: randomQuaternion(random),
      angularVelocity: [(random() * 2 - 1) * spin, (random() * 2 - 1) * spin, (random() * 2 - 1) * spin],
    });
    this.bodyKind[index] = kindIndex;
    this.bodySlot[index] = mesh.count;
    this.bodyScale[index] = scale;
    mesh.count++;
    this.spawned++;
  }

  // Writes each body's transform into its column-major instance matrix without allocating.
  private sync() {
    const { position: p, rotation: q } = this.world;
    for (let i = 0; i < this.world.count; i++) {
      const { mesh } = this.kinds[this.bodyKind[i]];
      const m = mesh.instanceMatrix.array as Float32Array;
      const o = this.bodySlot[i] * 16;
      const s = this.bodyScale[i];
      const x = q[i * 4];
      const y = q[i * 4 + 1];
      const z = q[i * 4 + 2];
      const w = q[i * 4 + 3];
      m[o] = (1 - 2 * (y * y + z * z)) * s;
      m[o + 1] = 2 * (x * y + w * z) * s;
      m[o + 2] = 2 * (x * z - w * y) * s;
      m[o + 3] = 0;
      m[o + 4] = 2 * (x * y - w * z) * s;
      m[o + 5] = (1 - 2 * (x * x + z * z)) * s;
      m[o + 6] = 2 * (y * z + w * x) * s;
      m[o + 7] = 0;
      m[o + 8] = 2 * (x * z + w * y) * s;
      m[o + 9] = 2 * (y * z - w * x) * s;
      m[o + 10] = (1 - 2 * (x * x + y * y)) * s;
      m[o + 11] = 0;
      m[o + 12] = p[i * 3];
      m[o + 13] = p[i * 3 + 1];
      m[o + 14] = p[i * 3 + 2];
      m[o + 15] = 1;
    }
    for (const { mesh } of this.kinds) {
      mesh.instanceMatrix.needsUpdate = true;
      // Clear the cached bounds so they are recomputed for the moved instances. Shadow fitting uses them.
      mesh.boundingBox = null;
      mesh.boundingSphere = null;
    }
  }
}
