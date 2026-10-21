import { act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { Platform } from "react-native";
import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../../../core/src/__tests__/glb";
import { Group } from "../Group";
import {
  download,
  forgetDownloads,
  isDownloaded,
  loadModelBytes,
  Model,
  measureModel,
  modelCache,
  textureCache,
  useTexture,
  useTextureState,
} from "../Model";
import { optional } from "../optional";
import { renderScene, stepFrames } from "./render";
import { assetState } from "./setup";

const originalOS = Platform.OS;
const asNative = () => {
  (Platform as { OS: string }).OS = "ios";
};
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  vi.unstubAllGlobals();
});

describe("loadModelBytes", () => {
  it("reads bundled assets from disk on native", async () => {
    asNative();
    const bytes = makeGlb();
    assetState.files.set("file:///asset-7", bytes);
    expect(await loadModelBytes(7)).toBe(bytes);
    assetState.noLocalFile = true;
    await expect(loadModelBytes(7)).rejects.toThrow(/no local file/);
  });

  it("copies Android drawable resources to a file before reading them", async () => {
    asNative();
    assetState.androidResources = true;
    const bytes = new Uint8Array([9, 9]).buffer;
    assetState.files.set("file:///asset-8", bytes);
    expect(await loadModelBytes(8)).toBe(bytes);
  });

  it("fetches bundled assets on web and URLs everywhere", async () => {
    const bytes = makeGlb();
    const fetch = vi.fn(async () => ({ arrayBuffer: async () => bytes }));
    vi.stubGlobal("fetch", fetch);
    expect(await loadModelBytes(3)).toBe(bytes);
    expect(fetch).toHaveBeenCalledWith("http://bundle/asset-3");
    expect(await loadModelBytes("https://example.com/car.glb")).toBe(bytes);
    expect(fetch).toHaveBeenLastCalledWith("https://example.com/car.glb");
  });
});

describe("downloads", () => {
  const CAR = "https://example.com/models/Car.GLB";
  const BOAT = "https://example.com/models/boat.glb?v=2";
  /** A server with these files (others: 404), counting what it sends. */
  const server = (files: Record<string, ArrayBuffer>) => {
    const sent: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      sent.push(url);
      const bytes = files[url];
      return bytes ? { ok: true, status: 200, arrayBuffer: async () => bytes } : { ok: false, status: 404 };
    });
    vi.stubGlobal("fetch", fetch);
    return sent;
  };
  const kept = () =>
    [...assetState.files.keys()].filter(
      (path) => path.startsWith("cache/apricot/downloads/") && !path.endsWith("/"),
    );

  it("keeps a URL's file on the phone once fetched, and reads it from there, offline too", async () => {
    asNative();
    const bytes = makeGlb(["remote"]);
    const sent = server({ [CAR]: bytes });
    expect(isDownloaded(CAR)).toBe(false);
    expect(new Uint8Array(await loadModelBytes(CAR))).toEqual(new Uint8Array(bytes));
    expect(kept()).toEqual([expect.stringMatching(/^cache\/apricot\/downloads\/[0-9a-f]{16}\.glb$/)]);
    expect(isDownloaded(CAR)).toBe(true);
    // Offline, it is read from the device.
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(new Uint8Array(await loadModelBytes(CAR))).toEqual(new Uint8Array(bytes));
    expect(sent).toEqual([CAR]);
    // A missing file rejects, and nothing is kept.
    server({});
    await expect(loadModelBytes("https://example.com/gone.glb")).rejects.toThrow(/gone\.glb: 404/);
    expect(kept()).toHaveLength(1);
  });

  it("downloads a pack a few at a time, skipping what is there, and forgets it", async () => {
    asNative();
    const sent = server({ [CAR]: makeGlb(["car"]), [BOAT]: makeGlb(["boat"]) });
    await loadModelBytes(CAR);
    const progress = vi.fn();
    await download([CAR, BOAT], { onProgress: progress });
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(sent).toEqual([CAR, BOAT]);
    expect([isDownloaded(CAR), isDownloaded(BOAT)]).toEqual([true, true]);
    // Forgets one file, then all of them.
    forgetDownloads([BOAT]);
    expect([isDownloaded(CAR), isDownloaded(BOAT)]).toEqual([true, false]);
    forgetDownloads();
    expect(kept()).toEqual([]);
    forgetDownloads();
    forgetDownloads([CAR]);
    // A file that isn't there fails the download.
    await expect(download([CAR, "https://example.com/gone.glb"])).rejects.toThrow(/404/);
    expect(isDownloaded(CAR)).toBe(true);
  });

  it("keeps nothing on the web (the browser's cache does), and needs expo-file-system on a phone", async () => {
    const sent = server({ [CAR]: makeGlb() });
    await download([CAR]);
    expect(sent).toEqual([]);
    await loadModelBytes(CAR);
    expect(isDownloaded(CAR)).toBe(false);
    expect(kept()).toEqual([]);
    asNative();
    const fileSystem = optional.fileSystem;
    optional.fileSystem = null;
    try {
      await expect(download([CAR])).rejects.toThrow(/npx expo install expo-file-system/);
      expect(isDownloaded(CAR)).toBe(false);
    } finally {
      optional.fileSystem = fileSystem;
    }
  });
});

describe("<Model>", () => {
  it("loads once, gives each user its own copy and frees the model after the last one", async () => {
    asNative();
    assetState.files.set("file:///asset-11", makeGlb(["body", "wheel_fl"]));
    const onLoad = vi.fn();
    const ref = createRef<THREE.Object3D>();
    const view = await renderScene(
      <>
        <Model src={11} ref={ref} onLoad={onLoad} position={[1, 0, 0]} />
        <Model src={11} />
      </>,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    const copies = view.scene.scene.children.filter((c) => c.getObjectByName("wheel_fl"));
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toBe(copies[1]);
    expect(ref.current).toBe(onLoad.mock.calls[0][0]);
    expect(modelCache.size).toBe(1);
    view.update(null);
    await act(async () => {});
    expect(modelCache.size).toBe(0);
  });

  it("stands on the floor with `ground`, placed by a group that takes the ref", async () => {
    asNative();
    // A model whose lowest point is 0.4 below its origin.
    assetState.files.set("file:///asset-12", makeGlb(["body"], undefined, undefined, undefined, -0.4));
    const onLoad = vi.fn();
    const ref = createRef<THREE.Object3D>();
    await renderScene(<Model src={12} ground ref={ref} onLoad={onLoad} position={[2, 0, 0]} />);
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await stepFrames(1);
    const model = onLoad.mock.calls[0][0] as THREE.Object3D;
    expect(model.position.y).toBeCloseTo(0.4);
    expect(model.parent).toBe(ref.current);
    expect(ref.current?.position.x).toBe(2);
    model.updateWorldMatrix(true, true);
    expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(0);
  });

  it("measures a model without showing it, once per model, scale and ground", async () => {
    // Its triangle: x 0 to 1, y -0.4 to 0.6, z 0.
    const bytes = makeGlb(["body"], undefined, undefined, undefined, -0.4);
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("gone.glb")) throw new Error("offline");
      return { arrayBuffer: async () => bytes };
    });
    vi.stubGlobal("fetch", fetch);
    const extent = await measureModel("https://example.com/measure.glb");
    expect(extent.minX).toBeCloseTo(0);
    expect(extent.maxX).toBeCloseTo(1);
    expect(extent.minY).toBeCloseTo(-0.4);
    expect(extent.maxY).toBeCloseTo(0.6);
    const big = await measureModel("https://example.com/measure.glb", { scale: 2, ground: true });
    expect([big.maxX, big.minY, big.maxY]).toEqual([expect.closeTo(2), 0, expect.closeTo(2)]);
    await measureModel("https://example.com/measure.glb");
    expect(fetch).toHaveBeenCalledTimes(2);
    // Measuring does not keep the model loaded.
    expect(modelCache.size).toBe(0);
    // A failed measurement is tried again next time.
    await expect(measureModel("https://example.com/gone.glb")).rejects.toThrow("offline");
    await expect(measureModel("https://example.com/gone.glb")).rejects.toThrow("offline");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("loads from a URL and wraps non-Error failures", async () => {
    const bytes = makeGlb(["remote"]);
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("bad.glb")) throw "offline";
      return { arrayBuffer: async () => bytes };
    });
    const onLoad = vi.fn();
    const onError = vi.fn();
    await renderScene(
      <>
        <Model src="https://example.com/car.glb" onLoad={onLoad} />
        <Model src="https://example.com/bad.glb" onError={onError} />
      </>,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(onLoad.mock.calls[0][0].getObjectByName("remote")).toBeDefined();
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" })),
    );
  });

  it("reports load errors to onError, or logs them", async () => {
    asNative();
    const onError = vi.fn();
    await renderScene(<Model src={404} onError={onError} />);
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("no such file") }),
      ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderScene(<Model src={405} />);
    await waitFor(() => expect(log).toHaveBeenCalled());
    log.mockRestore();
  });

  it("swaps to a new src in one go, once it is compiled, keeping its children", async () => {
    asNative();
    assetState.files.set("file:///asset-21", makeGlb(["sofa"]));
    assetState.files.set("file:///asset-22", makeGlb(["mug"]));
    const onReady = vi.fn();
    const ref = createRef<THREE.Object3D>();
    const label = createRef<THREE.Object3D>();
    const tree = (src: number, keepPrevious?: boolean) => (
      <Model src={src} ref={ref} onReady={onReady} keepPrevious={keepPrevious} position={[1, 0, 0]}>
        <Group ref={label} name="label" />
      </Model>
    );
    const before = modelCache.size;
    const view = await renderScene(tree(21));
    await waitFor(() => expect(ref.current?.getObjectByName("sofa")).toBeDefined());
    await stepFrames(3);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const sofa = ref.current as THREE.Object3D;
    expect(onReady).toHaveBeenCalledWith(sofa, 21);
    const child = label.current;
    expect(child?.parent).toBe(sofa);

    // The next model is prepared out of frames while the sofa stays.
    let compile = () => {};
    const compiled = vi
      .spyOn(view.scene, "compiled")
      .mockImplementation(() => new Promise<void>((resolve) => (compile = resolve)));
    const holdBack = vi.spyOn(view.scene, "holdBack");
    view.update(tree(22));
    await waitFor(() => expect(holdBack).toHaveBeenCalled());
    const mug = holdBack.mock.calls[0]?.[0] as THREE.Object3D;
    expect(mug.getObjectByName("mug")).toBeDefined();
    expect(mug.parent).toBe(view.scene.scene);
    expect(mug.position.x).toBe(1);
    expect(sofa.parent).toBe(view.scene.scene);
    expect(ref.current).toBe(sofa);
    expect(compiled).toHaveBeenCalledWith(mug);
    // The sofa stays loaded while it shows.
    expect(modelCache.size).toBe(before + 2);

    // Once compiled, the models swap and the same label object moves to the new one.
    await act(async () => compile());
    expect(sofa.parent).toBeNull();
    expect(ref.current).toBe(mug);
    expect(label.current).toBe(child);
    expect(child?.parent).toBe(mug);
    expect(modelCache.size).toBe(before + 1);
    await stepFrames(3);
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(mug, 22));

    // Without keepPrevious, the model goes at once and the next one appears when ready.
    compiled.mockRestore();
    view.update(tree(21, false));
    await act(async () => {});
    await waitFor(() => expect(ref.current?.getObjectByName("sofa")).toBeDefined());
    expect(mug.parent).toBeNull();
    view.update(null);
    await act(async () => {});
    expect(modelCache.size).toBe(before);
  });

  it("ignores a load that finishes after unmount", async () => {
    asNative();
    assetState.files.set("file:///asset-12", makeGlb());
    let open = () => {};
    assetState.gate = new Promise((resolve) => {
      open = resolve;
    });
    const onLoad = vi.fn();
    const onError = vi.fn();
    const view = await renderScene(
      <>
        <Model src={12} onLoad={onLoad} />
        <Model src={406} onError={onError} />
      </>,
    );
    view.update(null);
    await act(async () => {
      open();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("useTexture", () => {
  const bitmap = { width: 4, height: 2, close() {} };

  it("decodes a bundled image once, shares it and disposes it after the last user", async () => {
    asNative();
    vi.stubGlobal("navigator", { product: "ReactNative" });
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    assetState.files.set("file:///asset-21", new Uint8Array([1, 2, 3]).buffer);
    const latest: Record<string, THREE.Texture | null> = {};
    function Probe({ id }: { id: string }) {
      latest[id] = useTexture(21, id === "data" ? { colorSpace: THREE.NoColorSpace } : {});
      return null;
    }
    const view = await renderScene(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="data" />
      </>,
    );
    await waitFor(() => expect(Object.values(latest).filter(Boolean)).toHaveLength(3));
    const { a, b, data } = latest as Record<string, THREE.Texture>;
    expect(a.image).toBe(bitmap);
    // Same options share one texture; different options get their own.
    expect(b).toBe(a);
    expect(data).not.toBe(a);
    expect(data.colorSpace).toBe(THREE.NoColorSpace);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(textureCache.size).toBe(2);
    const dispose = vi.spyOn(a, "dispose");
    view.update(null);
    await act(async () => {});
    expect(textureCache.size).toBe(0);
    expect(dispose).toHaveBeenCalled();
  });

  it("reports failures (also non-Error ones) and ignores results after unmount", async () => {
    asNative();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useTexture(999);
      return null;
    }
    await renderScene(<Probe />);
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith("[apricot] Texture failed to load:", expect.any(Error)),
    );
    // useTextureState hands the error to the app, also for non-Error failures.
    let failure: Error | null = null;
    function Status() {
      failure = useTextureState(998).error;
      return null;
    }
    await renderScene(<Status />);
    await waitFor(() => expect(failure?.message).toMatch(/no such file/));
    vi.stubGlobal("fetch", async () => {
      throw "offline";
    });
    let remote: Error | null = null;
    function Remote() {
      remote = useTextureState("https://example.com/x.png").error;
      return null;
    }
    await renderScene(<Remote />);
    await waitFor(() => expect(remote?.message).toBe("offline"));
    log.mockClear();
    let open = () => {};
    assetState.gate = new Promise((resolve) => {
      open = resolve;
    });
    const view = await renderScene(<Probe />);
    view.update(null);
    await act(async () => {
      open();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
