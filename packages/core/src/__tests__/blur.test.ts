import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { BLUR_LAYER, BlurLayer, type BlurRenderer } from "../blur";

/** A renderer that records where it draws, with a 400×800-pixel canvas. */
const recorder = ({ compile = true } = {}) => {
  let target: THREE.RenderTarget | null = null;
  let clearAlpha = 1;
  const clearColor = new THREE.Color("#123456");
  const draws: {
    target: THREE.RenderTarget | null;
    layers: number;
    background: unknown;
    clearAlpha: number;
  }[] = [];
  let finish: (() => void) | null = null;
  const renderer: BlurRenderer = {
    render: (scene, camera) => {
      draws.push({
        target,
        layers: camera.layers.mask,
        background: (scene as THREE.Scene).background,
        clearAlpha,
      });
    },
    setRenderTarget: (next) => {
      target = next as THREE.RenderTarget | null;
    },
    getRenderTarget: () => target,
    getDrawingBufferSize: (out) => out.set(400, 800),
    getClearColor: (out) => out.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (_color, alpha = 1) => {
      clearAlpha = alpha;
    },
    ...(compile
      ? {
          compileAsync: () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        }
      : {}),
  } as BlurRenderer;
  return {
    renderer,
    draws,
    finish: async () => finish?.(),
    current: () => target,
    clearAlpha: () => clearAlpha,
  };
};

const setup = (options = {}) => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#ffffff");
  const light = new THREE.DirectionalLight();
  const camera = new THREE.PerspectiveCamera();
  const layer = new BlurLayer(options);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicNodeMaterial());
  layer.group.add(ball);
  scene.add(light, layer.group, layer.backdrop);
  return { scene, light, camera, layer, ball };
};

describe("BlurLayer", () => {
  it("draws its group, lit, into a small image blurred across and down, after compiling it", async () => {
    const { scene, light, camera, layer, ball } = setup({ radius: 6 });
    const r = recorder();
    // First: the group's shaders compile in the background; nothing shows yet.
    expect(layer.render(r.renderer, scene, camera, 200)).toBe(false);
    expect(layer.backdrop.visible).toBe(false);
    expect(ball.layers.mask).toBe(1 << BLUR_LAYER);
    expect(light.layers.isEnabled(BLUR_LAYER)).toBe(true);
    expect(r.draws).toHaveLength(0);
    await r.finish();
    await Promise.resolve();
    expect(layer.ready).toBe(true);

    expect(layer.render(r.renderer, scene, camera, 200)).toBe(true);
    expect(layer.backdrop.visible).toBe(true);
    // The group, then the two blur passes: into the image, a spare, and back.
    expect(r.draws).toHaveLength(3);
    const [group, across, down] = r.draws;
    expect(group.layers).toBe(1 << BLUR_LAYER);
    expect(group.background).toBeNull();
    expect(group.clearAlpha).toBe(0);
    expect(across.target).not.toBe(group.target);
    expect(down.target).toBe(group.target);
    expect(across.layers).toBe(down.layers);
    expect(across.layers).not.toBe(group.layers);
    // 2 pixels a point, radius 6: one texel per 6 pixels.
    const image = group.target as THREE.RenderTarget;
    expect([image.width, image.height]).toEqual([67, 133]);
    // Everything put back.
    expect(r.current()).toBeNull();
    expect(r.clearAlpha()).toBe(1);
    expect((scene.background as THREE.Color).getHexString()).toBe("ffffff");

    // A softer blur: a smaller image.
    layer.setRadius(12);
    layer.render(r.renderer, scene, camera, 200);
    expect((r.draws[3].target as THREE.RenderTarget).width).toBe(33);
    layer.dispose();
  });

  it("compiles again for new objects, draws nothing without any, and works without compileAsync", async () => {
    const { scene, camera, layer, ball } = setup();
    const r = recorder({ compile: false });
    expect(layer.render(r.renderer, scene, camera)).toBe(true);
    // One pixel a point by default: radius 6 is a texel every 3 pixels of the 400.
    expect((r.draws[0].target as THREE.RenderTarget).width).toBe(133);
    layer.group.remove(ball);
    expect(layer.render(r.renderer, scene, camera)).toBe(false);
    expect(layer.backdrop.visible).toBe(false);

    const compiling = recorder();
    const fresh = setup();
    fresh.layer.render(compiling.renderer, fresh.scene, fresh.camera);
    // Another object before the first compile ends: not ready until that one compiles too.
    fresh.layer.group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    fresh.layer.render(compiling.renderer, fresh.scene, fresh.camera);
    await compiling.finish();
    await Promise.resolve();
    expect(fresh.layer.ready).toBe(true);
  });
});
