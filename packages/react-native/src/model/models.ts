import { type Extent, footprintOf } from "@apricotjs/core";
import { instance, type LoadedModel, ModelCache, parseModel } from "@apricotjs/core/models";
import { useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { loadModelBytes, type ModelSource } from "./files";

const sources = new Map<string, ModelSource>();

/** The cache key for `src`. Remembers the source so the cache can load it by key. */
export const keyOf = (src: ModelSource) => {
  const key = typeof src === "number" ? `asset:${src}` : src;
  sources.set(key, src);
  return key;
};

/** The source a key from keyOf stands for. */
export const sourceOf = (key: string) => sources.get(key) as ModelSource;

/** Every model the app loads, shared between components and released when unused. */
export const modelCache = new ModelCache(async (key) => parseModel(await loadModelBytes(sourceOf(key))));

const measured = new Map<string, Promise<Extent>>();

/**
 * Measures a model as <Model src> would show it, without showing it.
 * Resolves to its extent around its origin, in metres; with `ground`, as if
 * standing on its lowest point, like <Model ground>. Use it with
 * <Placement>'s findFreePlace before an object is added. Each model, scale
 * and ground combination is measured once.
 */
export const measureModel = (
  src: ModelSource,
  { scale = 1, ground = false }: { scale?: number; ground?: boolean } = {},
): Promise<Extent> => {
  const key = keyOf(src);
  const id = `${key}|${scale}|${ground}`;
  let extent = measured.get(id);
  if (!extent) {
    extent = modelCache.acquire(key).then((model) => {
      try {
        const object = instance(model);
        object.scale.setScalar(scale);
        const holder = new THREE.Group().add(object);
        const size = footprintOf(holder) ?? { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        return ground ? { ...size, minY: 0, maxY: size.maxY - size.minY } : size;
      } finally {
        modelCache.release(key);
      }
    });
    // A failed measurement is not cached, so it is tried again next time.
    extent.catch(() => measured.delete(id));
    measured.set(id, extent);
  }
  return extent;
};

export interface ModelState {
  object: THREE.Group | null;
  /** The model's animation clips, shared by every copy. */
  animations: THREE.AnimationClip[];
  error: Error | null;
}

export const NO_CLIPS: THREE.AnimationClip[] = [];

/** The key of the model each copy from useModel was made from. Right after `src` changes, useModel still returns the previous copy. */
export const copyOf = new WeakMap<THREE.Group, string>();

/**
 * Loads a .glb, once per app and shared, and returns this component's own
 * copy of it, or null while it loads. The model is released when its last
 * user unmounts.
 */
export function useModel(src: ModelSource): ModelState {
  const [state, setState] = useState<ModelState>({ object: null, animations: NO_CLIPS, error: null });
  const key = keyOf(src);
  useEffect(() => {
    let cancelled = false;
    setState({ object: null, animations: NO_CLIPS, error: null });
    modelCache.acquire(key).then(
      (model: LoadedModel) => {
        if (cancelled) return;
        const object = instance(model);
        copyOf.set(object, key);
        setState({ object, animations: model.animations, error: null });
      },
      (e: unknown) => {
        if (!cancelled)
          setState({
            object: null,
            animations: NO_CLIPS,
            error: e instanceof Error ? e : new Error(String(e)),
          });
      },
    );
    return () => {
      cancelled = true;
      modelCache.release(key);
    };
  }, [key]);
  return state;
}
