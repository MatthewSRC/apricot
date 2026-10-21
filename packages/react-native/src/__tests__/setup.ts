// Test doubles for native modules. Kept small and behavioural so component
// tests exercise the real Apricot code paths.

import { cleanup } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { afterEach, vi } from "vitest";

/** The GPU canvas context every mocked <Canvas> hands out. */
export const canvasState = {
  clientWidth: 200,
  clientHeight: 100,
  /** Set to make getContext() return null (canvas not ready). */
  unavailable: false,
  /** On the web, the id of the canvas element is `rnwgpu-canvas-<contextId>`. */
  contextId: undefined as number | undefined,
  presents: 0,
};

vi.mock("react-native-webgpu", () => ({
  Canvas: forwardRef(function Canvas(_props: Record<string, unknown>, ref) {
    useImperativeHandle(ref, () => ({
      getContextId: () => canvasState.contextId,
      getContext: () =>
        canvasState.unavailable
          ? null
          : {
              canvas: {
                width: 0,
                height: 0,
                clientWidth: canvasState.clientWidth,
                clientHeight: canvasState.clientHeight,
              },
              present: () => canvasState.presents++,
            },
    }));
    return null;
  }),
}));

// three's real renderer needs a GPU: swap in a recorder.
export const rendererState = {
  failInit: false,
  renders: 0,
  /** Renders into a render target (not the canvas). */
  targetRenders: 0,
  /** When set, init() waits for it (to test unmounting mid-startup). */
  initGate: null as Promise<void> | null,
};
vi.mock("three/webgpu", async (importOriginal) => {
  const THREE = await importOriginal<typeof import("three/webgpu")>();
  class FakeRenderer {
    toneMapping = 0;
    async init() {
      if (rendererState.initGate) await rendererState.initGate;
      if (rendererState.failInit) throw new Error("no GPU");
      return this;
    }
    render() {
      rendererState.renders++;
      if (this.target) rendererState.targetRenders++;
    }
    // Render targets, for <Blur>: a 600×1200-pixel canvas.
    target: unknown = null;
    setRenderTarget(target: unknown) {
      this.target = target;
    }
    getRenderTarget() {
      return this.target;
    }
    getDrawingBufferSize(out: { set: (x: number, y: number) => unknown }) {
      return out.set(600, 1200);
    }
    getClearColor(out: unknown) {
      return out;
    }
    getClearAlpha() {
      return 1;
    }
    setSize() {}
    setPixelRatio() {}
    setClearColor() {}
    async setAnimationLoop() {}
    dispose() {}
  }
  return { ...THREE, WebGPURenderer: FakeRenderer };
});

// Shared values: a plain box. useAnimatedReaction re-runs when the value
// changes through `set` (tests call it explicitly).
type Listener = () => void;
/** Mounted useAnimatedStyle hooks: any shared value change re-renders them (Reanimated would update them on the UI thread). */
const animatedStyles = new Set<Listener>();
export const sharedValue = <T>(initial: T) => {
  const listeners = new Set<Listener>();
  const sv = {
    __isShared: true,
    _value: initial,
    get value() {
      return sv._value;
    },
    set value(v: T) {
      sv._value = v;
      for (const l of listeners) l();
      for (const l of animatedStyles) l();
    },
    listeners,
  };
  return sv;
};

vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  const { useReducer, useEffect: useEffectHook, useState } = await import("react");
  return {
    default: { View },
    useSharedValue: <T>(initial: T) => useState(() => sharedValue(initial))[0],
    useAnimatedStyle: (style: () => object) => {
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      useEffectHook(() => {
        animatedStyles.add(rerender);
        return () => {
          animatedStyles.delete(rerender);
        };
      }, []);
      return style();
    },
    isSharedValue: (v: unknown) =>
      typeof v === "object" && v !== null && (v as { __isShared?: boolean }).__isShared === true,
    useAnimatedReaction: (
      prepare: () => unknown,
      react: (next: unknown, previous: unknown) => void,
      deps: unknown[],
    ) => {
      useEffect(() => {
        // Counted: each one is a call to the UI runtime on a phone.
        const counted = globalThis as { reactionsStarted?: number };
        counted.reactionsStarted = (counted.reactionsStarted ?? 0) + 1;
        let previous: unknown = null;
        const run = () => {
          const next = prepare();
          react(next, previous);
          previous = next;
        };
        run();
        const shared = deps[0] as { listeners?: Set<Listener> } | null;
        shared?.listeners?.add(run);
        return () => {
          shared?.listeners?.delete(run);
        };
        // biome-ignore lint/correctness/useExhaustiveDependencies: mirrors Reanimated's explicit deps
      }, deps);
    },
  };
});

/** Set `unsupported` to make createSynchronizable throw, as it does on web. */
export const workletsState = { unsupported: false };

vi.mock("react-native-worklets", () => ({
  createSynchronizable: <T>(initial: T) => {
    if (workletsState.unsupported)
      throw new Error("[Worklets] `createSynchronizable` is not supported on web.");
    let value = initial;
    return {
      getDirty: () => value,
      setBlocking: (next: T) => {
        value = next;
      },
    };
  },
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

/** Bundled assets for the mocked expo-asset: module number → file bytes. */
export const assetState = {
  files: new Map<string, ArrayBuffer>(),
  /** Set to make downloadAsync() leave no local file. */
  noLocalFile: false,
  /** Behave like an Android release build: images are drawable resources at first. */
  androidResources: false,
  /** When set, file reads wait for it (to test unmounting mid-load). */
  gate: null as Promise<void> | null,
};
vi.mock("expo-asset", () => ({
  Asset: {
    fromModule: (module: number) => ({
      name: `asset-${module}`,
      uri: `http://bundle/asset-${module}`,
      localUri: null as string | null,
      downloaded: false,
      async downloadAsync() {
        if (this.downloaded) return;
        this.downloaded = true;
        if (assetState.androidResources && this.localUri === null && !this.copied) {
          // expo-asset reports the drawable resource name, marked as downloaded.
          this.localUri = `assets_images_asset${module}`;
          this.copied = true;
          return;
        }
        this.localUri = assetState.noLocalFile ? null : `file:///asset-${module}`;
      },
      copied: false,
    }),
  },
}));
// Files kept in assetState.files by path; folders as "<path>/".
vi.mock("expo-file-system", () => {
  const pathOf = (parts: unknown[]) =>
    parts.map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri)).join("/");
  class Directory {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(parts);
    }
    get exists() {
      return assetState.files.has(`${this.uri}/`);
    }
    create() {
      assetState.files.set(`${this.uri}/`, new ArrayBuffer(0));
    }
    delete() {
      for (const path of [...assetState.files.keys()])
        if (path.startsWith(`${this.uri}/`)) assetState.files.delete(path);
    }
  }
  class File {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(parts);
    }
    get exists() {
      return assetState.files.has(this.uri);
    }
    create() {
      assetState.files.set(this.uri, new ArrayBuffer(0));
    }
    write(content: Uint8Array) {
      assetState.files.set(this.uri, content.slice().buffer);
    }
    delete() {
      assetState.files.delete(this.uri);
    }
    async arrayBuffer() {
      if (assetState.gate) await assetState.gate;
      const bytes = assetState.files.get(this.uri);
      if (!bytes) throw new Error(`no such file: ${this.uri}`);
      return bytes;
    }
  }
  return { File, Directory, Paths: { cache: new Directory("cache"), document: new Directory("documents") } };
});

// The optional packages, as the mocks above (Metro's try/catch require is not Vitest's).
vi.mock("../optional", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../optional")>();
  Object.assign(actual.optional, {
    reanimated: await import("react-native-reanimated"),
    worklets: await import("react-native-worklets"),
    fileSystem: await import("expo-file-system"),
    asset: await import("expo-asset"),
  });
  return actual;
});

// requestAnimationFrame driven by tests (jsdom's would tick on its own).
export const frames = {
  queue: [] as FrameRequestCallback[],
  now: 0,
  /** Runs the pending frame callbacks, advancing time by `ms`. */
  step(ms = 16) {
    frames.now += ms;
    const callbacks = frames.queue.splice(0);
    for (const cb of callbacks) cb(frames.now);
  },
};
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => frames.queue.push(cb);
globalThis.cancelAnimationFrame = () => {};

afterEach(() => {
  // Vitest has no globals, so Testing Library's automatic cleanup does not run.
  cleanup();
  assetState.files.clear();
  assetState.noLocalFile = false;
  assetState.androidResources = false;
  assetState.gate = null;
  canvasState.unavailable = false;
  canvasState.contextId = undefined;
  canvasState.presents = 0;
  rendererState.failInit = false;
  rendererState.renders = 0;
  rendererState.initGate = null;
  frames.queue.length = 0;
});
