import type { Document, NodeIO } from "@gltf-transform/core";

export interface ModelSummary {
  meshes: number;
  materials: number;
  textures: number;
  vertices: number;
  /** Triangles drawn, counting every node that uses a mesh. */
  triangles: number;
  /** One entry per node that has a mesh. */
  parts: { name: string; triangles: number; materials: string[] }[];
  materialNames: string[];
  textureList: { name: string; mimeType: string; width: number; height: number; bytes: number }[];
  animations: string[];
  extensions: string[];
}

export interface OptimizeResult {
  bytes: Uint8Array;
  report: { before: ModelSummary; after: ModelSummary; byteLength: number; warnings: string[] };
}

/**
 * Optimises a glTF for Apricot. Removes duplicate and unused data, welds vertices and,
 * unless `options.quantize` is false, quantizes meshes so no runtime decoder is needed.
 * Throws for KTX2/Basis textures.
 */
export function optimizeModel(
  input: Uint8Array | Document,
  options?: { quantize?: boolean },
): Promise<OptimizeResult>;
/** Counts the meshes, materials, textures, vertices and triangles in a document. */
export function summarize(document: Document): ModelSummary;
/** A gltf-transform NodeIO with every extension and the Draco and meshopt decoders registered. */
export function createModelIO(): Promise<NodeIO>;
/** Limits for one hero model on a mid-range phone. `textureSide` is in pixels, `textureBytes` in bytes. */
export const BUDGET: { triangles: number; textureSide: number; textureBytes: number };
/** Returns a warning for each way the summary exceeds BUDGET. Empty when it fits. */
export function budgetWarnings(summary: ModelSummary): string[];
