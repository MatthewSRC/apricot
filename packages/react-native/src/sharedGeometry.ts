import { useEffect, useMemo } from "react";
import type * as THREE from "three/webgpu";

// Shapes of the same kind and size share one geometry across all scenes, so repeated parts
// (book spines, leaves, the same room in two carousel pages) are built once.
const sharedGeometries = new Map<string, { geometry: THREE.BufferGeometry; users: number }>();

/** The number of geometries currently shared between shapes. */
export const sharedGeometryCount = () => sharedGeometries.size;

/**
 * Returns the geometry for a `kind` of shape and `key`, the values `make`
 * reads. The first caller's `make` builds it; every shape with the same kind
 * and key shares it. It is disposed when its last user unmounts.
 */
export const useSharedGeometry = (kind: string, make: () => THREE.BufferGeometry, key: unknown[]) => {
  const id = `${kind}:${JSON.stringify(key)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `id` stands for what `make` reads
  const entry = useMemo(() => {
    let found = sharedGeometries.get(id);
    if (!found) {
      found = { geometry: make(), users: 0 };
      sharedGeometries.set(id, found);
    }
    return found;
  }, [id]);
  useEffect(() => {
    entry.users++;
    // Re-register in case the last user released it between render and this effect.
    sharedGeometries.set(id, entry);
    return () => {
      entry.users--;
      if (entry.users === 0 && sharedGeometries.get(id) === entry) {
        sharedGeometries.delete(id);
        entry.geometry.dispose();
      }
    };
  }, [entry, id]);
  return entry.geometry;
};
