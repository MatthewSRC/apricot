import * as THREE from "three/webgpu";

const mix = (hash: number, value: number) => (Math.imul(hash, 31) + value) | 0;

/**
 * A hash of what `root` draws (which objects show, with which geometry,
 * material version and instance count) and of `lights`. Moving objects does
 * not change it; adding, removing, hiding or swapping them does. Also turns
 * off frustum culling under `root`, because a bundle records only what the
 * camera sees at the time, and objects out of view would stay missing when
 * the camera turns.
 */
export const bundleFingerprint = (root: THREE.Object3D, lights: readonly THREE.Light[] = []) => {
  let hash = 17;
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) {
      hash = mix(hash, -object.id);
      return;
    }
    object.frustumCulled = false;
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) {
      hash = mix(hash, mesh.id);
      hash = mix(hash, mesh.geometry.id);
      hash = mix(hash, mesh.layers.mask);
      hash = mix(hash, mesh.renderOrder);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        hash = mix(hash, (material as unknown as { id: number }).id);
        hash = mix(hash, material.version);
      }
      const copies = mesh as THREE.InstancedMesh;
      if (copies.isInstancedMesh) hash = mix(hash, copies.count);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  // Lights change the shaders of everything they light.
  for (const light of lights) {
    hash = mix(hash, light.id);
    hash = mix(hash, light.visible ? 1 : 0);
    hash = mix(hash, light.castShadow ? 1 : 0);
  }
  return hash;
};

/**
 * A group of still objects recorded once as a WebGPU render bundle and
 * replayed every frame, which costs the CPU a fraction of drawing them one
 * by one. Objects inside may move and rotate freely. Adding, removing,
 * hiding or changing the geometry or material of an object records the
 * bundle again (see bundleFingerprint).
 */
export class StillGroup extends THREE.BundleGroup {
  private fingerprint = Number.NaN;

  constructor() {
    super();
    // Not static, so three checks each object for movement every frame, and a dragged object
    // updates without recording the bundle again.
    this.static = false;
  }

  /**
   * Marks the bundle to be recorded again if what it draws changed. Call it
   * before each frame. Returns true if the bundle will be recorded again.
   */
  check(lights: readonly THREE.Light[]) {
    const next = bundleFingerprint(this, lights);
    if (next === this.fingerprint) return false;
    this.fingerprint = next;
    this.needsUpdate = true;
    return true;
  }
}

type Recording = {
  _currentRenderBundle: unknown;
  _renderBundle: (...args: unknown[]) => void;
  __nestsBundles?: true;
};

/**
 * Lets a bundle record while another draw runs inside it. three r186 keeps
 * a reference to the bundle being recorded and clears it when a bundle
 * finishes. Recording one bundle can start another, because the first
 * object in it that receives shadows draws the shadow map with its own
 * bundle, and that clears the reference to the outer one. What the outer
 * bundle draws next still lands in it, but three no longer tracks it, so on
 * replay those objects keep the camera of the frame they were recorded in.
 * This patch restores the outer reference. Does nothing to a renderer
 * without bundles, such as a test double.
 */
export const nestBundles = (renderer: unknown) => {
  const recording = renderer as Recording;
  if (typeof recording?._renderBundle !== "function" || recording.__nestsBundles) return;
  const record = recording._renderBundle;
  recording._renderBundle = function (this: Recording, ...args: unknown[]) {
    const outer = this._currentRenderBundle;
    try {
      record.apply(this, args);
    } finally {
      this._currentRenderBundle = outer;
    }
  };
  recording.__nestsBundles = true;
};

const SKIP = "apricot:skipBundles";

/**
 * Marks `camera` to draw the contents of bundles one by one instead of
 * replaying them (see skipBundlesFor), or unmarks it when `skip` is false.
 * Used for shadow maps, so a caster can stop casting while it is dragged
 * without recording its bundle again, and for the shader warm-up, because
 * three compiles only objects outside bundles.
 */
export const skipBundles = (camera: THREE.Camera, skip = true) => {
  if (skip) camera.userData[SKIP] = true;
  else delete camera.userData[SKIP];
};

/** Whether `camera` draws what is in bundles one by one (see skipBundles). */
export const skipsBundles = (camera: THREE.Camera) => camera.userData[SKIP] === true;

type Projecting = {
  _projectObject: (object: THREE.Object3D, camera: THREE.Camera, ...rest: unknown[]) => void;
  __skipsBundles?: true;
};

/**
 * Lets cameras marked by skipBundles draw the contents of bundles as plain
 * groups. Does nothing to a renderer without bundles, such as a test double.
 */
export const skipBundlesFor = (renderer: unknown) => {
  const projecting = renderer as Projecting;
  if (typeof projecting?._projectObject !== "function" || projecting.__skipsBundles) return;
  const project = projecting._projectObject;
  projecting._projectObject = function (this: Projecting, object, camera, ...rest) {
    const bundle = object as { isBundleGroup?: boolean };
    if (!bundle.isBundleGroup || camera.userData[SKIP] !== true)
      return project.call(this, object, camera, ...rest);
    bundle.isBundleGroup = false;
    try {
      project.call(this, object, camera, ...rest);
    } finally {
      bundle.isBundleGroup = true;
    }
  };
  projecting.__skipsBundles = true;
};

type Ordering = {
  _renderTransparents: (...args: unknown[]) => void;
  _currentRenderContext: unknown;
  // The per-object handler: draws the object, or creates its pipeline during compileAsync.
  _handleObjectFunction?: unknown;
  _createObjectPipeline?: unknown;
  backend: {
    get: (context: unknown) => {
      renderBundles?: unknown[];
      currentPass?: { executeBundles?: (bundles: unknown[]) => void } | null;
      currentSets?: unknown;
    };
  };
  __bundlesFirst?: true;
};

/**
 * Draws bundles before the transparent objects outside them. three r186's
 * WebGPU backend runs a frame's bundles at the end of the pass, so a
 * transparent object outside a bundle, such as sparks or a glow, is painted
 * over by the bundle's contents even where it is in front. This patch runs
 * the bundles queued so far when the transparent objects start. Running
 * bundles resets what the pass has bound, so three's record of the bound
 * state is reset too. Does nothing to a renderer without bundles, such as a
 * test double.
 */
export const drawBundlesFirst = (renderer: unknown) => {
  const ordering = renderer as Ordering;
  if (typeof ordering?._renderTransparents !== "function" || ordering.__bundlesFirst) return;
  const transparents = ordering._renderTransparents;
  ordering._renderTransparents = function (this: Ordering, ...args: unknown[]) {
    // compileAsync also comes through here. It has no open pass, only the previous frame's ended
    // one, and a shared renderer may compile one scene between frames of another.
    if (this._handleObjectFunction !== undefined && this._handleObjectFunction === this._createObjectPipeline)
      return transparents.apply(this, args);
    const data = this._currentRenderContext ? this.backend.get(this._currentRenderContext) : null;
    const pass = data?.currentPass;
    // While a bundle records, the pass is a bundle encoder, which cannot run bundles.
    if (data?.renderBundles?.length && typeof pass?.executeBundles === "function") {
      pass.executeBundles(data.renderBundles);
      data.renderBundles.length = 0;
      data.currentSets = { attributes: {}, bindingGroups: [], pipeline: null, index: null };
    }
    return transparents.apply(this, args);
  };
  ordering.__bundlesFirst = true;
};
