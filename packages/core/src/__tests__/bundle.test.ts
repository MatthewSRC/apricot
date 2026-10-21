import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  bundleFingerprint,
  drawBundlesFirst,
  nestBundles,
  StillGroup,
  skipBundles,
  skipBundlesFor,
} from "../bundle";
import { ApricotScene } from "../scene";
import { fakeContext, fakeRenderer, manualScheduler } from "./helpers";

const room = () => {
  const group = new StillGroup();
  const sofa: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
  const lamp: THREE.Mesh = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardNodeMaterial()]);
  group.add(sofa, lamp);
  return { group, sofa, lamp };
};

describe("bundleFingerprint", () => {
  it("ignores moves but notices what shows, what it is made of and how many copies", () => {
    const { group, sofa, lamp } = room();
    const first = bundleFingerprint(group);
    sofa.position.set(3, 0, 1);
    sofa.rotation.y = 1;
    expect(bundleFingerprint(group)).toBe(first);
    const changes: (() => void)[] = [
      () => {
        sofa.geometry = new THREE.SphereGeometry();
      },
      () => {
        (sofa.material as THREE.Material).needsUpdate = true;
      },
      () => {
        lamp.material = [new THREE.MeshBasicNodeMaterial()];
      },
      () => {
        group.add(new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial(), 3));
      },
    ];
    let last = first;
    for (const change of changes) {
      change();
      const next = bundleFingerprint(group);
      expect(next).not.toBe(last);
      last = next;
    }
    const copies = group.children.at(-1) as THREE.InstancedMesh;
    copies.count = 2;
    expect(bundleFingerprint(group)).not.toBe(last);
    last = bundleFingerprint(group);
    sofa.visible = false;
    expect(bundleFingerprint(group)).not.toBe(last);
  });

  it("notices the lights, and stops culling what it holds", () => {
    const { group, sofa } = room();
    const sun = new THREE.DirectionalLight();
    const before = bundleFingerprint(group, [sun]);
    sun.castShadow = true;
    expect(bundleFingerprint(group, [sun])).not.toBe(before);
    expect(sofa.frustumCulled).toBe(false);
  });
});

describe("StillGroup", () => {
  it("records again only when what it draws changes, and lets things inside move", () => {
    const { group, sofa } = room();
    expect(group.static).toBe(false);
    const version = () => (group as unknown as { version: number }).version;
    expect(group.check([])).toBe(true);
    const recorded = version();
    sofa.position.x = 2;
    expect(group.check([])).toBe(false);
    expect(version()).toBe(recorded);
    sofa.visible = false;
    expect(group.check([])).toBe(true);
    expect(version()).toBe(recorded + 1);
  });

  it("is checked by the scene before each frame, with the scene's lights", async () => {
    const s = manualScheduler();
    const scene = new ApricotScene({
      scheduler: s.scheduler,
      createRenderer: () => fakeRenderer(),
      warmUp: false,
    });
    await scene.attach(fakeContext() as never, { width: 100, height: 100, devicePixelRatio: 1 });
    const { group, sofa } = room();
    scene.scene.add(group);
    scene.bundles.add(group);
    scene.invalidate();
    s.step();
    const frames = () => scene.report().recentFrames as { rerecorded?: number }[];
    expect(frames().at(-1)?.rerecorded).toBe(1);
    scene.invalidate();
    s.step();
    expect(frames().at(-1)?.rerecorded).toBe(0);
    // A new light changes the shaders of what it shines on.
    scene.scene.add(new THREE.PointLight());
    sofa.position.x = 1;
    scene.invalidate();
    s.step();
    expect(frames().at(-1)?.rerecorded).toBe(1);
  });
});

describe("nestBundles", () => {
  it("keeps recording into a bundle after another one was recorded in its middle", () => {
    // As three's renderer: notes the bundle being recorded, and clears the note when done.
    const seen: unknown[] = [];
    const renderer = {
      _currentRenderBundle: null as unknown,
      _renderBundle(bundle: string, inner?: string) {
        this._currentRenderBundle = bundle;
        seen.push(this._currentRenderBundle);
        // The first thing that receives shadows draws the shadow map, with its own bundle.
        if (inner) this._renderBundle(inner);
        seen.push(this._currentRenderBundle);
        this._currentRenderBundle = null;
      },
    };
    nestBundles(renderer);
    nestBundles(renderer);
    renderer._renderBundle("room", "shadow");
    expect(seen).toEqual(["room", "shadow", "shadow", "room"]);
    expect(renderer._currentRenderBundle).toBeNull();
    // A renderer without bundles is left alone.
    expect(() => nestBundles({})).not.toThrow();
    expect(() => nestBundles(null)).not.toThrow();
  });
});

describe("skipBundlesFor", () => {
  it("draws a bundle as a plain group for cameras marked to skip bundles", () => {
    // As three's renderer: a bundle group is drawn as a bundle, unless it is not one.
    const seen: string[] = [];
    const renderer = {
      _projectObject(object: THREE.Object3D, camera: THREE.Camera) {
        seen.push(`${(object as THREE.BundleGroup).isBundleGroup ? "bundle" : "plain"}:${camera.name}`);
      },
    };
    skipBundlesFor(renderer);
    skipBundlesFor(renderer);
    const room = new StillGroup();
    const eye = new THREE.PerspectiveCamera();
    eye.name = "eye";
    const sun = new THREE.OrthographicCamera();
    sun.name = "sun";
    skipBundles(sun);
    renderer._projectObject(room, eye);
    renderer._projectObject(room, sun);
    renderer._projectObject(new THREE.Group(), sun);
    expect(seen).toEqual(["bundle:eye", "plain:sun", "plain:sun"]);
    // Still a bundle afterwards.
    expect(room.isBundleGroup).toBe(true);
    expect(() => skipBundlesFor({})).not.toThrow();
  });
});

describe("drawBundlesFirst", () => {
  it("runs the bundles queued so far before the see-through things, and forgets what the pass had bound", () => {
    const log: string[] = [];
    const queued = ["room", "furniture"];
    const data = {
      renderBundles: queued,
      currentPass: { executeBundles: (bundles: string[]) => log.push(`bundles ${bundles.join(" ")}`) },
      currentSets: { pipeline: "opaque" } as unknown,
    };
    const renderer = {
      _currentRenderContext: {},
      backend: { get: () => data },
      _renderTransparents: (...args: unknown[]) => log.push(`transparents ${args.length}`),
    };
    drawBundlesFirst(renderer);
    drawBundlesFirst(renderer);
    renderer._renderTransparents(1, 2);
    expect(log).toEqual(["bundles room furniture", "transparents 2"]);
    // Not run again at the end of the pass.
    expect(data.renderBundles).toHaveLength(0);
    expect(data.currentSets).toEqual({ attributes: {}, bindingGroups: [], pipeline: null, index: null });
    // None queued, or recording a bundle (no executeBundles): just the see-through things.
    renderer._renderTransparents();
    data.renderBundles = ["again"];
    data.currentPass = {} as typeof data.currentPass;
    renderer._renderTransparents();
    expect(log).toEqual(["bundles room furniture", "transparents 2", "transparents 0", "transparents 0"]);
    // Compiling (compileAsync): the pass is the last frame's, ended; nothing is run on it.
    const compiling = Object.assign(renderer, {
      _createObjectPipeline: () => {},
      _handleObjectFunction: undefined as unknown,
    });
    compiling._handleObjectFunction = compiling._createObjectPipeline;
    data.renderBundles = ["stale"];
    data.currentPass = { executeBundles: () => log.push("ran on an ended pass") };
    compiling._renderTransparents(1);
    expect(log.at(-1)).toBe("transparents 1");
    expect(data.renderBundles).toEqual(["stale"]);
    // Leaves a renderer without bundles alone.
    expect(() => drawBundlesFirst({})).not.toThrow();
  });
});
