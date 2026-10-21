import { float, max, positionGeometry, screenUV, texture, uniform, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

/** The three.js layer for blurred objects. The main camera does not see it. */
export const BLUR_LAYER = 30;
/** The layer of the blur's full-screen passes, which are drawn as part of the scene they blur. */
const PASS_LAYER = 29;

export interface BlurOptions {
  /** Blur radius in screen points (default 6). */
  radius?: number;
}

/** The renderer methods a blur needs. WebGPURenderer has them all. */
export type BlurRenderer = Pick<
  THREE.WebGPURenderer,
  | "render"
  | "setRenderTarget"
  | "getRenderTarget"
  | "getDrawingBufferSize"
  | "getClearColor"
  | "getClearAlpha"
  | "setClearColor"
> & {
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<void>;
};

// A 9-tap Gaussian (sigma 2 texels), run horizontally and then vertically
// over the small image, for 18 samples per texel.
const OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const WEIGHTS = OFFSETS.map((k) => Math.exp(-(k * k) / 8));
const TOTAL = WEIGHTS.reduce((a, b) => a + b, 0);

/** A full-screen quad whose positions are already in clip space. */
const fullScreen = (material: THREE.NodeMaterial) => {
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  return mesh;
};

/** A material that blurs `source` along `step`, which is one texel across or down. */
const blurPass = (source: THREE.Texture, step: THREE.UniformNode<"vec2", THREE.Vector2>) => {
  const sample = texture(source);
  let sum: THREE.Node<"vec4"> | null = null;
  OFFSETS.forEach((offset, i) => {
    const tap = sample.sample(screenUV.add(step.mul(offset))).mul(WEIGHTS[i] / TOTAL);
    sum = sum ? sum.add(tap) : tap;
  });
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, fog: false });
  material.colorNode = sum as unknown as THREE.Node<"vec4">;
  material.blending = THREE.NoBlending;
  return material;
};

/**
 * Objects drawn out of focus behind the rest of the scene, such as a
 * background of falling fruit or a skyline. Everything in `group` is drawn,
 * lit like the rest of the scene, into a small image. The image is blurred
 * and drawn over the background before anything else. It has a fraction of
 * the screen's pixels, so the blur is cheap.
 */
export class BlurLayer {
  /** Add the objects to blur to this group. */
  readonly group = new THREE.Group();
  /** A full-screen quad showing the blurred group, drawn first, behind everything. */
  readonly backdrop: THREE.Mesh;
  // The group is drawn into `target`, blurred across into `spare`, and down back into `target`.
  private readonly target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly spare = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly across = uniform(new THREE.Vector2(1, 0));
  private readonly down = uniform(new THREE.Vector2(0, 1));
  private readonly passCamera = new THREE.PerspectiveCamera();
  // One mesh per pass. three draws a mesh once per frame per target, so a
  // mesh shared by both passes would leave the second one empty.
  private readonly acrossPass: THREE.Mesh;
  private readonly downPass: THREE.Mesh;
  private readonly acrossMaterial: THREE.NodeMaterial;
  private readonly downMaterial: THREE.NodeMaterial;
  private readonly size = new THREE.Vector2();
  private readonly clear = new THREE.Color();
  private radius: number;
  private meshes = -1;
  private compiling = false;
  /** False until the group's shaders are compiled. Nothing is drawn until then. */
  ready = false;

  constructor(options: BlurOptions = {}) {
    this.radius = options.radius ?? 6;
    this.group.name = "Blur";
    this.acrossMaterial = blurPass(this.target.texture, this.across);
    this.downMaterial = blurPass(this.spare.texture, this.down);
    this.acrossPass = fullScreen(this.acrossMaterial);
    this.downPass = fullScreen(this.downMaterial);
    for (const pass of [this.acrossPass, this.downPass]) {
      pass.name = "Blur pass";
      pass.layers.set(PASS_LAYER);
      pass.visible = false;
      this.group.add(pass);
    }
    this.passCamera.layers.set(PASS_LAYER);

    // The image holds premultiplied colour over a clear background. Dividing
    // by alpha lets the edges blend into what is behind instead of darkening.
    // The material blends but is not transparent, so it is drawn with the
    // opaque objects (first, by renderOrder) rather than last, over everything.
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
    const blurred = texture(this.target.texture).sample(screenUV);
    material.colorNode = vec4(blurred.rgb.div(max(blurred.a, float(1e-4))), blurred.a);
    this.backdrop = fullScreen(material);
    this.backdrop.name = "Blur backdrop";
    this.backdrop.renderOrder = -1e9;
  }

  setRadius(radius: number) {
    this.radius = radius;
  }

  /**
   * Draws the group into the small image. Call it before the scene renders,
   * with the scene and camera it renders and the canvas width in points,
   * which scales the radius (default one point per pixel). Returns whether
   * it drew.
   */
  render(renderer: BlurRenderer, scene: THREE.Scene, camera: THREE.Camera, widthInPoints = 0) {
    // Puts every object in the group on the blur layer only, and every light on it too.
    let meshes = 0;
    this.group.traverse((object) => {
      if (object === this.acrossPass || object === this.downPass) return;
      object.layers.set(BLUR_LAYER);
      if ((object as THREE.Mesh).isMesh) meshes++;
    });
    scene.traverse((object) => {
      if ((object as THREE.Light).isLight) object.layers.enable(BLUR_LAYER);
    });
    this.camera.copy(camera as THREE.PerspectiveCamera);
    this.camera.layers.set(BLUR_LAYER);

    // New meshes are compiled in the background first, because the scene's
    // warm-up sees only the main camera's layers. Nothing shows until then.
    if (meshes !== this.meshes) {
      this.meshes = meshes;
      if (renderer.compileAsync) {
        this.ready = false;
        this.compiling = true;
        const compiled = meshes;
        renderer
          .compileAsync(scene, this.camera)
          .catch(() => {})
          .then(() => {
            this.compiling = false;
            if (this.meshes === compiled) this.ready = true;
          });
      } else {
        this.ready = true;
      }
    }
    this.backdrop.visible = this.ready && meshes > 0;
    if (!this.backdrop.visible || this.compiling) return false;

    // One pixel of the small image covers several screen pixels.
    renderer.getDrawingBufferSize(this.size);
    const pixelRatio = widthInPoints > 0 ? this.size.x / widthInPoints : 1;
    // The Gaussian's sigma is 2 texels, so a texel covers half the radius.
    const step = Math.min(16, Math.max(1, (this.radius * pixelRatio) / 2));
    const width = Math.max(1, Math.round(this.size.x / step));
    const height = Math.max(1, Math.round(this.size.y / step));
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
      this.spare.setSize(width, height);
    }
    this.across.value.set(1 / width, 0);
    this.down.value.set(0, 1 / height);

    const background = scene.background;
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.clear);
    const alpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(scene, this.camera);
      this.acrossPass.visible = true;
      renderer.setRenderTarget(this.spare);
      renderer.render(scene, this.passCamera);
      this.acrossPass.visible = false;
      this.downPass.visible = true;
      renderer.setRenderTarget(this.target);
      renderer.render(scene, this.passCamera);
    } finally {
      this.acrossPass.visible = false;
      this.downPass.visible = false;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(this.clear, alpha);
      scene.background = background;
    }
    return true;
  }

  dispose() {
    this.target.dispose();
    this.spare.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.acrossPass.geometry.dispose();
    this.downPass.geometry.dispose();
    this.acrossMaterial.dispose();
    this.downMaterial.dispose();
  }
}
