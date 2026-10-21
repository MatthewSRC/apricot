import { boxBlur } from "three/addons/tsl/display/boxBlur.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { float, int, mix, pass, sample, unpackRGBToNormal, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export interface OcclusionOptions {
  /** How far a surface darkens what is near it, in metres (default 0.3). */
  radius?: number;
  /** How dark the occlusion gets, 0 to 1 (default 0.9). */
  strength?: number;
  /** Resolution of the occlusion pass relative to the screen (default 0.5, a quarter of the pixels). */
  resolution?: number;
  /** Directions sampled around each point (default 16). Fewer is faster and noisier. */
  samples?: number;
}

/** What the scene needs from a renderer to draw occlusion (three's WebGPURenderer). */
type OcclusionRenderer = THREE.WebGPURenderer;

type Contexts = { get: (target?: unknown, mrt?: unknown, depth?: number) => unknown };

type Pass = ReturnType<typeof pass> & { renderTarget: THREE.RenderTarget; options: { samples?: number } };

/**
 * Ambient occlusion for a scene: soft darkening where surfaces meet or come
 * close, which makes a render look solid. A first pass draws everything with
 * one plain material for depth and normals. three's GTAO computes the
 * occlusion from them at reduced resolution. The result is blurred and
 * multiplied into the scene, which a second pass draws as usual with
 * antialiasing.
 */
export class SceneOcclusion {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly prePass: Pass;
  private readonly scenePass: Pass;
  private readonly occlusion: ReturnType<typeof ao>;
  private readonly normals = new THREE.MeshNormalNodeMaterial();
  // While compileAsync points the renderer at a pass's target, the target frames should use instead.
  // Undefined when nothing is compiling.
  private compiling: THREE.RenderTarget | null | undefined;

  constructor(
    private readonly renderer: OcclusionRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    { radius = 0.3, strength = 0.9, resolution = 0.5, samples = 16 }: OcclusionOptions = {},
  ) {
    // Depth and normals only, with one unlit material for everything, so it needs few shaders.
    const prePass = pass(scene, camera, { samples: 0 }) as Pass;
    prePass.overrideMaterial = this.normals;
    prePass.transparent = false;
    const packed = prePass.getTextureNode();
    const normal = sample((uv) => unpackRGBToNormal(packed.sample(uv)));
    const occlusion = ao(prePass.getTextureNode("depth"), normal, camera);
    occlusion.resolutionScale = resolution;
    occlusion.radius.value = radius;
    occlusion.samples.value = samples;
    // Blurs away GTAO's 4×4 noise pattern. Temporal filtering does not suit frames drawn on demand.
    const smooth = boxBlur(occlusion.getTextureNode(), { size: int(2), separation: int(1) }).r;
    const shade = mix(float(1), smooth, float(strength));
    const scenePass = pass(scene, camera) as Pass;
    const color = scenePass.getTextureNode();
    this.pipeline = new THREE.RenderPipeline(renderer, vec4(color.rgb.mul(shade), color.a));
    this.prePass = prePass;
    this.scenePass = scenePass;
    this.occlusion = occlusion;
  }

  /** Draws a frame with occlusion (instead of renderer.render). */
  render() {
    this.toScreen(() => this.pipeline.render());
  }

  /**
   * Runs `draw` with the renderer pointed at the screen, even while
   * compileAsync has it pointed at a pass's target.
   */
  toScreen(draw: () => void) {
    const { compiling, renderer } = this;
    if (compiling === undefined) return draw();
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(compiling);
    try {
      draw();
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  /**
   * Compiles shaders the way the occlusion draws them: plain normals for the
   * first pass's target and the scene's own materials for the second's.
   * Compiles the whole scene, or only `roots` lit by the scene's lights.
   * As with renderer.compileAsync, objects are collected synchronously, so
   * call it while they are set up. Shaders are built later, so each pass's
   * target stays set until it is done, and frames drawn meanwhile go through
   * toScreen.
   */
  async compileAsync(roots: readonly THREE.Object3D[] = [this.scene]) {
    const { scene, renderer } = this;
    // The first pass is drawn inside the occlusion node's draw, which is inside the pipeline's (depth 2).
    await this.compileInto(roots, this.prePass, 2, () => {
      const override = scene.overrideMaterial;
      const transparent = renderer.transparent;
      scene.overrideMaterial = this.normals;
      renderer.transparent = false;
      return () => {
        scene.overrideMaterial = override;
        renderer.transparent = transparent;
      };
    });
    await this.compileInto(roots, this.scenePass, 1);
  }

  /**
   * Compiles `roots` for `node`'s pass. `depth` is how deeply the pass's
   * draw is nested, the pipeline's own draw being 0. three keys render
   * contexts by that depth, so compiling at another depth would build
   * pipelines that are never used.
   */
  private async compileInto(
    roots: readonly THREE.Object3D[],
    node: Pass,
    depth: number,
    collect?: () => () => void,
  ) {
    const { renderer, scene, camera } = this;
    const target = node.renderTarget;
    // The formats the pass sets on its first frame, so the compiled shaders match.
    target.texture.type = renderer.getOutputBufferType();
    target.samples = node.options.samples ?? renderer.samples;
    const before = renderer.getRenderTarget();
    this.compiling = before;
    renderer.setRenderTarget(target);
    const contexts = (renderer as unknown as { _renderContexts?: Contexts })._renderContexts;
    const get = contexts?.get;
    try {
      const restore = collect?.();
      if (contexts && get) contexts.get = (target, mrt, at = depth) => get.call(contexts, target, mrt, at);
      let done: Promise<unknown>;
      try {
        done = Promise.all(
          roots.map((root) =>
            root === scene
              ? renderer.compileAsync(scene, camera)
              : renderer.compileAsync(root, camera, scene),
          ),
        );
      } finally {
        if (contexts && get) contexts.get = get;
        restore?.();
      }
      await done;
    } finally {
      renderer.setRenderTarget(before);
      this.compiling = undefined;
    }
  }

  dispose() {
    this.pipeline.dispose();
    this.occlusion.dispose();
    this.prePass.dispose();
    this.scenePass.dispose();
    this.normals.dispose();
  }
}

/** Whether `renderer` can draw occlusion (three's WebGPURenderer, not a test double). */
export const canOcclude = (renderer: unknown): renderer is OcclusionRenderer =>
  (renderer as { isWebGPURenderer?: boolean } | null)?.isWebGPURenderer === true;
