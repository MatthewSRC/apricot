import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeObject } from "../dispose";
import { ImageBytesPlugin, instance, type LoadedModel, ModelCache, parseModel } from "../models";
import { makeGlb } from "./glb";

describe("parseModel", () => {
  it("parses a .glb from bytes and keeps node names", async () => {
    const model = await parseModel(makeGlb(["body", "wheel_fl"]));
    expect(model.scene.getObjectByName("wheel_fl")).toBeDefined();
    expect((model.scene.getObjectByName("body") as THREE.Mesh).isMesh).toBe(true);
    expect(model.animations).toEqual([]);
  });

  it("makes instances that share geometry", async () => {
    const model = await parseModel(makeGlb());
    const a = instance(model);
    const b = instance(model);
    expect(a).not.toBe(b);
    expect((a.getObjectByName("body") as THREE.Mesh).geometry).toBe(
      (b.getObjectByName("body") as THREE.Mesh).geometry,
    );
  });

  it("gives each copy of a rigged model its own skeleton", () => {
    const root = new THREE.Group();
    const bone = new THREE.Bone();
    bone.name = "hip";
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    root.add(skinned);
    const model: LoadedModel = { scene: root, animations: [] };
    const a = instance(model);
    const b = instance(model);
    const skinA = a.children[0] as THREE.SkinnedMesh;
    const skinB = b.children[0] as THREE.SkinnedMesh;
    expect(skinA.skeleton.bones[0]).toBe(a.getObjectByName("hip"));
    expect(skinA.skeleton.bones[0]).not.toBe(skinB.skeleton.bones[0]);
    expect(skinA.geometry).toBe(skinB.geometry);
  });

  it("reads shape keys (morph targets) by name", async () => {
    const model = await parseModel(
      makeGlb(["face"], undefined, undefined, { name: "Smile", offsets: [0, 1, 0, 0, 1, 0, 0, 1, 0] }),
    );
    const face = model.scene.getObjectByName("face") as THREE.Mesh;
    expect(face.morphTargetDictionary).toEqual({ Smile: 0 });
  });
});

describe("embedded textures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const bitmap = { width: 1, height: 1, close() {} };
  const baseColor = (model: Awaited<ReturnType<typeof parseModel>>) =>
    ((model.scene.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).map;

  it("decodes .glb images from their bytes, with the glTF sampler", async () => {
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("navigator", { product: "ReactNative" });
    const png = new Uint8Array([137, 80, 78, 71]);
    const model = await parseModel(
      makeGlb(["body"], {
        bytes: png,
        sampler: { magFilter: 9728, minFilter: 9729, wrapS: 33071, wrapT: 33648 },
      }),
    );
    const map = baseColor(model) as THREE.Texture;
    expect(map.image).toBe(bitmap);
    expect(map.name).toBe("paint");
    expect(map.flipY).toBe(false);
    expect([map.magFilter, map.minFilter, map.wrapS, map.wrapT]).toEqual([
      THREE.NearestFilter,
      THREE.LinearFilter,
      THREE.ClampToEdgeWrapping,
      THREE.MirroredRepeatWrapping,
    ]);
    expect(map.generateMipmaps).toBe(false);
    expect(
      Array.from(new Uint8Array((decode.mock.calls[0] as unknown[])[0] as ArrayBuffer)).slice(0, 4),
    ).toEqual(Array.from(png));
  });

  it("decodes data URIs, defaults the sampler, and leaves other URIs to three", async () => {
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    const dataUri = `data:image/png;base64,${btoa("PNG!")}`;
    const model = await parseModel(makeGlb(["body"], { uri: dataUri }));
    const map = baseColor(model) as THREE.Texture;
    expect(map.image).toBe(bitmap);
    expect([map.magFilter, map.minFilter, map.wrapS]).toEqual([
      THREE.LinearFilter,
      THREE.LinearMipmapLinearFilter,
      THREE.RepeatWrapping,
    ]);
    expect(map.generateMipmaps).toBe(true);
    // External files and textures without an image are left to three's loader.
    const parser = {
      json: { textures: [{ source: 0 }, {}], images: [{ uri: "paint.png" }] },
      associations: new Map(),
      getDependency: vi.fn(),
    };
    const plugin = new ImageBytesPlugin(parser);
    expect(plugin.loadTexture(0)).toBeNull();
    expect(plugin.loadTexture(1)).toBeNull();
    expect(parser.getDependency).not.toHaveBeenCalled();
  });
});

describe("ModelCache", () => {
  const fakeModel = (): LoadedModel => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
    return { scene, animations: [] };
  };

  it("loads once per key, counts users and disposes after the last release", async () => {
    const model = fakeModel();
    const load = vi.fn(async () => model);
    const cache = new ModelCache(load);
    const [a, b] = await Promise.all([cache.acquire("car"), cache.acquire("car")]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn((model.scene.children[0] as THREE.Mesh).geometry, "dispose");
    cache.release("car");
    expect(cache.size).toBe(1);
    cache.release("car");
    expect(cache.size).toBe(0);
    await Promise.resolve();
    expect(dispose).toHaveBeenCalled();
    cache.release("car"); // unknown key: ignored
    await cache.acquire("car");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retries failed loads, and survives releasing them", async () => {
    let fail = true;
    const dispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const cache = new ModelCache(async () => {
      if (fail) throw new Error("missing");
      return fakeModel();
    });
    // A fails (offline) and stays on screen showing the error.
    await expect(cache.acquire("x")).rejects.toThrow("missing");
    // B loads the same file later, and it works.
    fail = false;
    await expect(cache.acquire("x")).resolves.toBeDefined();
    // A goes away: B's model stays.
    cache.release("x");
    await Promise.resolve();
    expect(cache.size).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    // B goes away: freed.
    cache.release("x");
    await Promise.resolve();
    expect(cache.size).toBe(0);
    expect(dispose).toHaveBeenCalled();
    dispose.mockRestore();
    fail = true;
    const failing = new ModelCache(async () => {
      throw new Error("nope");
    });
    const pending = failing.acquire("y");
    failing.release("y");
    await expect(pending).rejects.toThrow("nope");
  });
});

describe("disposeObject", () => {
  it("disposes textures on materials too", () => {
    const map = new THREE.Texture();
    const material = new THREE.MeshStandardNodeMaterial({ map });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [material]);
    const textureDispose = vi.spyOn(map, "dispose");
    const root = new THREE.Group();
    root.add(mesh, new THREE.Object3D());
    disposeObject(root);
    expect(textureDispose).toHaveBeenCalled();
  });
});
