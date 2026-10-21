import { SharedCache, type TextureOptions, textureFromBytes } from "@apricotjs/core";
import { useEffect, useState } from "react";
import type * as THREE from "three/webgpu";
import { loadModelBytes, type ModelSource } from "./files";
import { keyOf } from "./models";

const textureSources = new Map<string, { src: ModelSource; options: TextureOptions }>();

/** Every texture the app loads with useTexture, shared and released when unused. */
export const textureCache = new SharedCache<THREE.Texture>(
  async (key) => {
    const { src, options } = textureSources.get(key) as { src: ModelSource; options: TextureOptions };
    return textureFromBytes(await loadModelBytes(src), options);
  },
  (texture) => texture.dispose(),
);

export interface TextureState {
  texture: THREE.Texture | null;
  error: Error | null;
}

/**
 * Loads a PNG or JPEG, bundled with `require` or from a URL, as a texture.
 * Returns null while it loads. The image is decoded natively from its bytes
 * (react-native-webgpu's createImageBitmap), shared between components, and
 * released after its last user unmounts.
 */
export function useTexture(src: ModelSource, options: TextureOptions = {}): THREE.Texture | null {
  return useTextureState(src, options).texture;
}

/** Like useTexture, but also returns the load error. */
export function useTextureState(src: ModelSource, options: TextureOptions = {}): TextureState {
  const [state, setState] = useState<TextureState>({ texture: null, error: null });
  // Every option is spelled out with its default, since NoColorSpace is "" and would vanish from the key.
  const { colorSpace = "srgb", flipY = true, repeat = false, premultiplyAlpha = true } = options;
  const key = `${keyOf(src)}|${JSON.stringify([colorSpace, flipY, repeat, premultiplyAlpha])}`;
  textureSources.set(key, { src, options });
  useEffect(() => {
    let cancelled = false;
    setState({ texture: null, error: null });
    textureCache.acquire(key).then(
      (texture) => {
        if (!cancelled) setState({ texture, error: null });
      },
      (e: unknown) => {
        if (cancelled) return;
        const error = e instanceof Error ? e : new Error(String(e));
        console.error("[apricot] Texture failed to load:", error);
        setState({ texture: null, error });
      },
    );
    return () => {
      cancelled = true;
      textureCache.release(key);
    };
  }, [key]);
  return state;
}
