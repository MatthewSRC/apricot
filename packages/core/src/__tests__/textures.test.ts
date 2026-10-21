import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImage, textureFromBytes } from "../textures";

const bitmap = { width: 2, height: 2, close() {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeImage", () => {
  it("passes bytes straight to createImageBitmap on React Native", async () => {
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", create);
    vi.stubGlobal("navigator", { product: "ReactNative" });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await decodeImage(bytes)).toBe(bitmap);
    expect(create).toHaveBeenCalledWith(bytes);
  });

  it("wraps bytes in a typed Blob in browsers", async () => {
    const create = vi.fn(async (_blob: Blob) => bitmap);
    vi.stubGlobal("createImageBitmap", create);
    await decodeImage(new Uint8Array([1]), "image/jpeg");
    const blob = create.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/jpeg");
  });

  it("explains a missing decoder", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(decodeImage(new Uint8Array([1]))).rejects.toThrow(/createImageBitmap/);
  });
});

describe("textureFromBytes", () => {
  it("makes an sRGB, flipped, clamped texture by default", async () => {
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    const texture = await textureFromBytes(new Uint8Array([1]));
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.flipY).toBe(true);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    // Premultiplied, as decoders hand it over: no lossy round trip for faint edge pixels.
    expect(texture.premultiplyAlpha).toBe(true);
    expect(texture.version).toBeGreaterThan(0);
  });

  it("supports data textures, no flip and repeating", async () => {
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    const texture = await textureFromBytes(new Uint8Array([1]), {
      colorSpace: THREE.NoColorSpace,
      flipY: false,
      repeat: true,
      premultiplyAlpha: false,
    });
    expect(texture.premultiplyAlpha).toBe(false);
    expect([texture.colorSpace, texture.flipY, texture.wrapS, texture.wrapT]).toEqual([
      THREE.NoColorSpace,
      false,
      THREE.RepeatWrapping,
      THREE.RepeatWrapping,
    ]);
  });
});
