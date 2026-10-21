import { describe, expect, it, vi } from "vitest";

const constructed: unknown[] = [];
vi.mock("three/webgpu", () => ({
  WebGPURenderer: class {
    constructor(params: unknown) {
      constructed.push(params);
    }
  },
}));

const { createRenderer, disposeRenderer, gpuSupport, NO_GPU_MESSAGE, sharedDevice, sharedDeviceProblem } =
  await import("../renderer");

describe("createRenderer", () => {
  it("binds three's WebGPURenderer to the canvas context and device", () => {
    const context = { canvas: { width: 1, height: 1 } } as unknown as GPUCanvasContext;
    const device = {} as GPUDevice;
    createRenderer({ context, device });
    expect(constructed.at(-1)).toEqual({
      antialias: true,
      canvas: context.canvas,
      context,
      device,
      trackTimestamp: false,
      forceWebGL: false,
    });
    createRenderer({ context, antialias: false, trackTimestamp: true });
    expect(constructed.at(-1)).toMatchObject({ antialias: false, trackTimestamp: true });
  });

  it("draws with WebGL 2 given a WebGL 2 context", () => {
    const context = {
      canvas: { width: 1, height: 1 },
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    createRenderer({ context });
    expect(constructed.at(-1)).toMatchObject({ canvas: context.canvas, context, forceWebGL: true });
  });

  it("fails to start without a WebGPU adapter rather than fall back to WebGL on a canvas it has no context for", () => {
    const context = { canvas: { width: 1, height: 1 } } as unknown as GPUCanvasContext;
    const renderer = createRenderer({ context }) as unknown as { _getFallback: (error: unknown) => unknown };
    expect(() => renderer._getFallback(new Error("Unable to create WebGPU adapter."))).toThrow(
      `${NO_GPU_MESSAGE} (Unable to create WebGPU adapter.)`,
    );
  });
});

describe("gpuSupport", () => {
  it("is none without WebGPU or a document to make a WebGL 2 canvas in, as on a phone without an adapter", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    try {
      expect(await gpuSupport()).toBe("none");
      expect(sharedDeviceProblem()).toBe("no adapter");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is webgl where a canvas can have a WebGL 2 context", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: (kind: string) => (kind === "webgl2" ? {} : null) }),
    });
    try {
      expect(await gpuSupport()).toBe("webgl");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sharedDevice", () => {
  it("asks for one device for every scene, as three would, and a new one once it is lost", async () => {
    let lose: () => void = () => {};
    const devices: object[] = [];
    const requestDevice = vi.fn(async (descriptor: { requiredFeatures: string[] }) => {
      const device = { descriptor, lost: new Promise<void>((resolve) => (lose = resolve)) };
      devices.push(device);
      return device;
    });
    // Features that can only be asked one by one (react-native-webgpu).
    const features = { has: (name: string) => name === "float32-filterable" || name === "timestamp-query" };
    const requestAdapter = vi.fn(async () => ({ features, requestDevice }));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    try {
      const [a, b] = await Promise.all([sharedDevice(), sharedDevice()]);
      expect(a).toBe(b);
      expect(requestAdapter).toHaveBeenCalledTimes(1);
      expect(requestAdapter).toHaveBeenCalledWith({ featureLevel: "compatibility" });
      expect(requestDevice).toHaveBeenCalledWith({
        requiredFeatures: ["timestamp-query", "float32-filterable"],
      });
      lose();
      await Promise.resolve();
      await Promise.resolve();
      const c = await sharedDevice();
      expect(c).not.toBe(a);
      expect(devices).toHaveLength(2);
      lose();
      await Promise.resolve();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives none without WebGPU, or when the adapter won't, and says why", async () => {
    vi.stubGlobal("navigator", {});
    expect(await sharedDevice()).toBeUndefined();
    expect(sharedDeviceProblem()).toBe("no navigator.gpu");
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => null } });
    expect(await sharedDevice()).toBeUndefined();
    expect(sharedDeviceProblem()).toBe("no adapter");
    vi.stubGlobal("navigator", { gpu: { requestAdapter: async () => Promise.reject(new Error("no")) } });
    expect(await sharedDevice()).toBeUndefined();
    expect(sharedDeviceProblem()).toBe("Error: no");
    // A device that doesn't say when it is lost is still shared.
    const device = {};
    const features = { has: () => false };
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({ features, requestDevice: async () => device }) },
    });
    expect(await sharedDevice()).toBe(device);
    expect(sharedDeviceProblem()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("disposeRenderer", () => {
  it("stops the animation loop and disposes", () => {
    const calls: string[] = [];
    disposeRenderer({
      setAnimationLoop: (cb: unknown) => {
        calls.push(`loop ${cb}`);
        return Promise.resolve();
      },
      dispose: () => {
        calls.push("dispose");
      },
    } as never);
    expect(calls).toEqual(["loop null", "dispose"]);
  });
});
