import type { ApricotScene, Pixels } from "@apricotjs/core";
import { Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePng } from "../../../core/src/__tests__/png";
import { captureScene, captureUri, clearCaptures, deleteCapture } from "../capture";
import { optional } from "../optional";

// An in-memory stand-in for the app's cache.
const files = vi.hoisted(() => new Map<string, Uint8Array | string>());
vi.mock("expo-file-system", () => {
  const pathOf = (...parts: unknown[]) =>
    parts.map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri)).join("/");
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists() {
      return files.has(`${this.uri}/`);
    }
    create() {
      files.set(`${this.uri}/`, "");
    }
    list() {
      const inside = [...files.keys()].filter(
        (key) => key.startsWith(`${this.uri}/`) && key !== `${this.uri}/`,
      );
      return inside.map((key) => ({ name: key.slice(this.uri.length + 1), delete: () => files.delete(key) }));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = pathOf(...parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, "");
    }
    write(content: Uint8Array) {
      files.set(this.uri, content);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: new Directory("cache"), document: new Directory("documents") } };
});

/** A scene whose next frame is `width` × `height` of one opaque colour. */
const sceneOf = (width: number, height: number) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([200, 100, 50, 255], i * 4);
  const capture = vi.fn(async (): Promise<Pixels> => ({ width, height, data }));
  return { scene: { capture } as unknown as ApricotScene, capture };
};

const onPhone = () => {
  const os = Platform.OS;
  Platform.OS = "android";
  return () => {
    Platform.OS = os;
  };
};

afterEach(() => {
  files.clear();
  vi.restoreAllMocks();
});

describe("captureScene", () => {
  it("saves the next frame as a PNG in the app's cache on a phone, made smaller to fit", async () => {
    const back = onPhone();
    try {
      const { scene, capture } = sceneOf(400, 200);
      const shot = await captureScene(scene, { maxSize: 100, name: "share" });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(shot).toEqual({ uri: "cache/apricot/share.png", width: 100, height: 50 });
      const file = files.get(shot.uri) as Uint8Array;
      expect([...file.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
      // Every pixel has the drawn colour.
      const picture = decodePng(file);
      expect([picture.width, picture.height]).toEqual([100, 50]);
      expect(picture.data.every((v, i) => v === [200, 100, 50, 255][i % 4])).toBe(true);
      // Saving under the same name replaces the file. Without a name, each capture gets its own.
      await captureScene(scene, { maxSize: [50, 50], name: "share" });
      const other = await captureScene(scene);
      expect(other.uri).toMatch(/^cache\/apricot\/capture-\d+\.png$/);
      expect([other.width, other.height]).toEqual([400, 200]);
    } finally {
      back();
    }
  });

  it("keeps pictures in the documents if asked, and finds them again by name", async () => {
    const back = onPhone();
    try {
      const { scene } = sceneOf(4, 4);
      expect(captureUri("room-1")).toBeNull();
      const shot = await captureScene(scene, { name: "room-1", directory: "documents" });
      expect(shot.uri).toBe("documents/apricot/room-1.png");
      expect(captureUri("room-1", { directory: "documents" })).toBe(shot.uri);
      // It is not in the cache.
      expect(captureUri("room-1")).toBeNull();
    } finally {
      back();
    }
    // Nothing is kept on the web.
    expect(captureUri("room-1", { directory: "documents" })).toBeNull();
  });

  it("deletes a picture by name, or all of them in a folder", async () => {
    const back = onPhone();
    try {
      const { scene } = sceneOf(4, 4);
      for (const name of ["a", "b"]) await captureScene(scene, { name, directory: "documents" });
      await captureScene(scene, { name: "c" });
      expect(deleteCapture("a", { directory: "documents" })).toBe(true);
      expect(deleteCapture("a", { directory: "documents" })).toBe(false);
      expect(captureUri("a", { directory: "documents" })).toBeNull();
      // Clears every picture in documents and leaves the cache alone.
      expect(clearCaptures({ directory: "documents" })).toBe(1);
      expect(captureUri("b", { directory: "documents" })).toBeNull();
      expect(captureUri("c")).not.toBeNull();
    } finally {
      back();
    }
    // On the web nothing is kept, so there is nothing to delete.
    expect([deleteCapture("c"), clearCaptures()]).toEqual([false, 0]);
  });

  it("needs expo-file-system on a phone", async () => {
    const back = onPhone();
    const fileSystem = optional.fileSystem;
    optional.fileSystem = null;
    try {
      await expect(captureScene(sceneOf(1, 1).scene)).rejects.toThrow(/npx expo install expo-file-system/);
    } finally {
      optional.fileSystem = fileSystem;
      back();
    }
  });

  it("makes a blob URL with the browser's encoder on the web", async () => {
    const put = vi.fn();
    const context = {
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: put,
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (done: (blob: Blob | null) => void, type: string) => done(new Blob([type])),
    };
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "canvas" ? canvas : create(tag)) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => "blob:picture");
    const shot = await captureScene(sceneOf(4, 2).scene);
    expect(shot).toEqual({ uri: "blob:picture", width: 4, height: 2 });
    expect([canvas.width, canvas.height]).toEqual([4, 2]);
    expect([...put.mock.calls[0][0].data.subarray(0, 4)]).toEqual([200, 100, 50, 255]);
    // Without a 2D canvas or a blob, it rejects with a clear message.
    canvas.getContext = () => null as never;
    await expect(captureScene(sceneOf(1, 1).scene)).rejects.toThrow(/no 2D canvas/);
    canvas.getContext = () => context;
    canvas.toBlob = (done) => done(null);
    await expect(captureScene(sceneOf(1, 1).scene)).rejects.toThrow(/no picture/);
  });
});
