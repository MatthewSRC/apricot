import * as THREE from "three/webgpu";
import { skipBundles } from "./bundle";
import { lightRect, worldBox } from "./shadows/bounds";
import { choiceOf, decide, SHADOW_ONLY_LAYER } from "./shadows/choice";

export { SHADOW_ONLY_LAYER, type ShadowChoice, setShadow, shadowOf } from "./shadows/choice";

export interface ShadowOptions {
  /** Shadow map resolution in texels (default 1024). 2048 is sharper and uses four times the memory. */
  size?: number;
  /** Edge softness in texels (default 2). With `blur`, how far edges are blurred, for example 8. */
  softness?: number;
  /**
   * Uses variance shadow maps for wide, soft edges, like shadows under room
   * light or an overcast sky. Default false, for crisp edges.
   */
  blur?: boolean;
  /** How dark shadows are, 0 to 1 (default 0.85). */
  darkness?: number;
  /**
   * Half the width in metres of the area that gets shadows, centred on what
   * the camera looks at. Use it for big scenes such as a city. By default
   * the area fits everything that casts a shadow.
   */
  radius?: number;
}

// Scratch objects.
const point = new THREE.Vector3();
const forward = new THREE.Vector3();
const box = new THREE.Box3();

/** A casting light's view, its shadow area, and where each caster was in that view at the last check. */
interface LightArea {
  view: THREE.OrthographicCamera;
  // Light-space area as left, right, bottom, top, near, far. Empty until first fitted.
  bounds: number[];
  footprints: WeakMap<THREE.Mesh, Float64Array>;
}

/**
 * Shadows from one directional light in a scene. Picks the light (the
 * brightest, or the ones marked to cast), decides what casts and receives,
 * fits the shadow camera to the area that matters, and redraws the shadow
 * map only when a caster moves or the light or area changes. Turning the
 * camera around a still scene never redraws it.
 */
export class SceneShadows {
  private readonly options: Required<Omit<ShadowOptions, "radius">> & { radius?: number };
  /** three's shadow map type for these shadows. The scene sets it on the renderer. */
  readonly type: THREE.ShadowMapType;
  private lights: THREE.DirectionalLight[] = [];
  // Each object's matrix, visibility and instances at the last check (see changed).
  private seen = new WeakMap<THREE.Object3D, Float64Array>();
  // Reused every frame.
  private readonly found = { directional: [] as THREE.DirectionalLight[], casters: [] as THREE.Mesh[] };
  private casters = 0;
  // The sum of the casters' ids at the last frame, so swapping one caster for another is noticed.
  private castersKey = 0;
  // Subtrees that cast no shadow for now, with the number of pauses on each (see pause).
  private readonly paused = new Map<THREE.Object3D, number>();
  // The casters that moved this frame (reused).
  private readonly moved: THREE.Mesh[] = [];
  private areas = new Map<THREE.DirectionalLight, LightArea>();
  /** How many times the shadow map was redrawn, for diagnostics. */
  redraws = 0;

  constructor(
    private readonly scene: THREE.Scene,
    options: ShadowOptions = {},
  ) {
    this.options = { size: 1024, softness: 2, darkness: 0.85, blur: false, ...options };
    this.type = this.options.blur ? THREE.VSMShadowMap : THREE.PCFShadowMap;
  }

  /** A summary for diagnostics reports. */
  describe() {
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      lights: this.lights.length,
      casters: this.casters,
      redraws: this.redraws,
      mapSize: this.options.size,
      blur: this.options.blur,
      radius: this.options.radius ?? null,
      // The first light's area in metres, as left, right, bottom, top, near, far.
      bounds: (this.lights[0] ? this.area(this.lights[0]).bounds : []).map(round),
    };
  }

  /**
   * Stops everything under `object` from casting a shadow until the returned
   * function is called. Use it for something that moves for a while, such as
   * a dragged piece, so the shadow map is redrawn when the movement starts
   * and ends instead of every frame.
   */
  pause(object: THREE.Object3D) {
    this.paused.set(object, (this.paused.get(object) ?? 0) + 1);
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      const left = (this.paused.get(object) ?? 1) - 1;
      if (left > 0) this.paused.set(object, left);
      else this.paused.delete(object);
    };
  }

  /** The lights casting shadows now. */
  get casting(): readonly THREE.DirectionalLight[] {
    return this.lights;
  }

  /**
   * Sets which lights cast and which meshes cast and receive. Call it before
   * compiling shaders, because shadows change them. Returns the meshes that
   * cast.
   */
  prepare() {
    const { directional, casters } = this.found;
    directional.length = 0;
    casters.length = 0;
    this.walk(this.scene, false);
    const chosen = directional.filter((l) => choiceOf(l)?.cast === true);
    const brightest = directional.reduce<THREE.DirectionalLight | null>(
      (best, l) => (choiceOf(l)?.cast !== false && (!best || l.intensity > best.intensity) ? l : best),
      null,
    );
    const next = chosen.length ? chosen : brightest ? [brightest] : [];
    for (const light of this.lights) if (!next.includes(light)) light.castShadow = false;
    for (const light of next) {
      // The light's shadow camera also sees shadow-only meshes.
      light.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
      // The shadow map is redrawn rarely while casters come and go (see pause), so bundles are drawn
      // into it one by one.
      skipBundles(light.shadow.camera);
      if (!light.castShadow || !this.lights.includes(light)) {
        light.castShadow = true;
        const shadow = light.shadow;
        shadow.autoUpdate = false;
        shadow.needsUpdate = true;
        shadow.mapSize.set(this.options.size, this.options.size);
        shadow.radius = this.options.softness;
        // Enough samples for a smooth blur. three's default of 8 shows bands at wide radii.
        if (this.options.blur)
          shadow.blurSamples = Math.min(32, Math.max(8, Math.round(this.options.softness * 2)));
        shadow.intensity = this.options.darkness;
        this.areas.set(light, {
          view: new THREE.OrthographicCamera(),
          bounds: [],
          footprints: new WeakMap(),
        });
      }
    }
    for (const light of this.areas.keys()) if (!next.includes(light)) this.areas.delete(light);
    this.lights = next;
    return casters;
  }

  // Visits visible objects, like traverseVisible. Nothing under a paused object casts.
  private walk(o: THREE.Object3D, paused: boolean) {
    if (!o.visible) return;
    const off = paused || (this.paused.size > 0 && this.paused.has(o));
    if ((o as THREE.DirectionalLight).isDirectionalLight)
      this.found.directional.push(o as THREE.DirectionalLight);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const { cast, receive } = decide(mesh);
      mesh.castShadow = cast && !off;
      mesh.receiveShadow = receive;
      if (mesh.castShadow) this.found.casters.push(mesh);
    }
    for (const child of o.children) this.walk(child, off);
  }

  /**
   * Call before each frame. `focus` is the point the camera looks at, such as
   * a camera rig's target, and is the centre of a `radius` area. Without it,
   * the area is centred where the camera's line of sight meets the ground.
   * Returns true if the shadow map is redrawn this frame.
   */
  update(camera: THREE.Camera, focus: THREE.Vector3 | null = null) {
    // Updates every world matrix once, so the render that follows can skip it.
    this.scene.updateMatrixWorld();
    const casters = this.prepare();
    if (this.lights.length === 0) return false;
    // Nothing casts now or at the last frame. When the last caster leaves, one more redraw clears
    // its shadow.
    if (casters.length === 0 && this.casters === 0) return false;
    let key = 0;
    for (const mesh of casters) key += mesh.id;
    let redraw = casters.length !== this.casters || key !== this.castersKey;
    this.casters = casters.length;
    this.castersKey = key;
    for (const light of this.lights) {
      // A light's target is not in the scene by default, so the scene does not update its matrix.
      if (!light.target.parent) light.target.updateMatrixWorld();
      if (this.changed(light)) redraw = true;
      if (this.changed(light.target)) redraw = true;
    }
    const moved = this.moved;
    moved.length = 0;
    for (const mesh of casters) if (this.changed(mesh)) moved.push(mesh);
    // The area follows the casters, or the camera when there is a radius, so it is refitted only when
    // they may have moved.
    const fitted = this.lights.every((light) => this.area(light).bounds.length > 0);
    if (this.options.radius !== undefined || redraw || moved.length > 0 || !fitted)
      for (const light of this.lights) if (this.fit(light, casters, camera, focus)) redraw = true;
    // A moved caster needs a redraw only if it is in the shadow area now or was before, since moving
    // out clears its shadow.
    for (const mesh of moved) if (this.footprintTouchesArea(mesh)) redraw = true;
    if (!redraw) return false;
    for (const light of this.lights) light.shadow.needsUpdate = true;
    this.redraws++;
    return true;
  }

  // Records the matrix, visibility and instances of `object`. Returns true if they changed since
  // the last call.
  private changed(object: THREE.Object3D) {
    const instanced = object as THREE.InstancedMesh;
    let record = this.seen.get(object);
    let differs = false;
    if (!record) {
      // 16 matrix elements, then visibility, instance count and instance matrix version.
      record = new Float64Array(19).fill(Number.NaN);
      this.seen.set(object, record);
      differs = true;
    }
    const e = object.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      if (record[i] !== e[i]) {
        record[i] = e[i];
        differs = true;
      }
    }
    const extra0 = object.visible ? 1 : 0;
    const extra1 = instanced.isInstancedMesh ? instanced.count : -1;
    const extra2 = instanced.isInstancedMesh ? instanced.instanceMatrix.version : -1;
    if (record[16] !== extra0 || record[17] !== extra1 || record[18] !== extra2) {
      record[16] = extra0;
      record[17] = extra1;
      record[18] = extra2;
      differs = true;
    }
    return differs;
  }

  // A casting light's area, created when it starts casting.
  private area(light: THREE.DirectionalLight) {
    let area = this.areas.get(light);
    if (!area) {
      area = { view: new THREE.OrthographicCamera(), bounds: [], footprints: new WeakMap() };
      this.areas.set(light, area);
    }
    return area;
  }

  // Whether `mesh`, now or where it was at the last check, lies in a light's shadow area.
  private footprintTouchesArea(mesh: THREE.Mesh) {
    const b = worldBox(mesh);
    let touches = false;
    for (const light of this.lights) {
      const area = this.area(light);
      const [left, right, bottom, top] = area.bounds;
      if (left === undefined || b.isEmpty()) {
        touches = true;
        continue;
      }
      const { minX, maxX, minY, maxY } = lightRect(b, area.view.matrixWorldInverse);
      const inside = (x0: number, x1: number, y0: number, y1: number) =>
        x1 >= left && x0 <= right && y1 >= bottom && y0 <= top;
      let last = area.footprints.get(mesh);
      if (!last) {
        last = new Float64Array(4).fill(Number.NaN);
        area.footprints.set(mesh, last);
      }
      // Comparisons with NaN (no footprint yet) are false, so only the new footprint counts.
      if (inside(last[0], last[1], last[2], last[3]) || inside(minX, maxX, minY, maxY)) touches = true;
      last.set([minX, maxX, minY, maxY]);
    }
    return touches;
  }

  // Fits the light's shadow camera to the area that matters. Returns true if it changed.
  private fit(
    light: THREE.DirectionalLight,
    casters: THREE.Mesh[],
    camera: THREE.Camera,
    focus: THREE.Vector3 | null,
  ) {
    const area = this.area(light);
    // The view from the light, as three's shadow camera will see it.
    const view = area.view;
    view.position.setFromMatrixPosition(light.matrixWorld);
    view.lookAt(point.setFromMatrixPosition(light.target.matrixWorld));
    view.updateMatrixWorld();
    const toLight = view.matrixWorldInverse;

    box.makeEmpty();
    for (const mesh of casters) box.union(worldBox(mesh));
    if (box.isEmpty()) return false;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const radius = this.options.radius;
    if (radius !== undefined) {
      // Centred on what the camera looks at, snapped to whole texels so edges do not shimmer.
      const texel = (2 * radius) / this.options.size;
      // `focus` is preferred: where the line of sight meets the ground circles as the camera orbits.
      const centre = (focus ? point.copy(focus) : this.lookedAt(camera, box.min.y, radius)).applyMatrix4(
        toLight,
      );
      const cx = Math.round(centre.x / texel) * texel;
      const cy = Math.round(centre.y / texel) * texel;
      [minX, maxX, minY, maxY] = [cx - radius, cx + radius, cy - radius, cy + radius];
    } else {
      ({ minX, maxX, minY, maxY } = lightRect(box, toLight));
      const pad = Math.max(maxX - minX, maxY - minY) * 0.04;
      [minX, maxX, minY, maxY] = [minX - pad, maxX + pad, minY - pad, maxY + pad];
    }
    // The depth range covers only casters that overlap the area in light space, since only they
    // can shade it.
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const mesh of casters) {
      const b = worldBox(mesh);
      // An instanced mesh with no instances has an empty box, whose corners would be infinite.
      if (b.isEmpty()) continue;
      const r = lightRect(b, toLight);
      if (r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY) continue;
      minZ = Math.min(minZ, r.minZ);
      maxZ = Math.max(maxZ, r.maxZ);
    }
    // No caster is over the area, so any thin slab will do.
    if (minZ > maxZ) [minZ, maxZ] = [-1, 1];
    // The shadow camera looks down -z, so near and far are negated depths. The current range is kept
    // while it still holds everything and is not much too deep, so small moves do not refit.
    let near = -maxZ;
    let far = -minZ;
    const [, , , , oldNear, oldFar] = area.bounds;
    if (
      oldNear !== undefined &&
      oldNear <= near &&
      oldFar >= far &&
      oldFar - oldNear < (far - near) * 2 + 2
    ) {
      [near, far] = [oldNear, oldFar];
    } else {
      const depthPad = (far - near) * 0.25 + 1;
      [near, far] = [near - depthPad, far + depthPad];
    }
    const next = [minX, maxX, minY, maxY, near, far];
    if (next.every((v, i) => Math.abs(v - (area.bounds[i] ?? Number.NaN)) < 1e-6)) return false;
    area.bounds = next;
    const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
    [shadowCamera.left, shadowCamera.right, shadowCamera.bottom, shadowCamera.top] = next;
    [shadowCamera.near, shadowCamera.far] = [next[4], next[5]];
    shadowCamera.updateProjectionMatrix();
    // Offsets lookups by 1.5 texels along the normal against shadow acne, whatever the area's size.
    light.shadow.bias = 0;
    light.shadow.normalBias = ((maxX - minX) / this.options.size) * 1.5;
    return true;
  }

  // Where the camera's line of sight meets the ground, or a point `radius` ahead when it does not
  // meet it nearby.
  private lookedAt(camera: THREE.Camera, ground: number, radius: number) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(forward);
    const origin = point.setFromMatrixPosition(camera.matrixWorld);
    const t = forward.y < -1e-3 ? (ground - origin.y) / forward.y : -1;
    const distance = t > 0 && t < radius * 20 ? t : radius;
    return origin.clone().addScaledVector(forward, distance);
  }
}
