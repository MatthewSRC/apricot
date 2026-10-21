// Build-time model optimisation for Apricot apps, run in Node.
//
// Hermes has no WebAssembly, so Draco, meshopt and KTX2/Basis decoders cannot run in the app.
// Compressed meshes are decoded here and written back quantized with KHR_mesh_quantization,
// which the GPU decodes without extra code.
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder } from "meshoptimizer";

/** Mesh compression extensions that the app cannot decode. */
const MESH_COMPRESSION = ["KHR_draco_mesh_compression", "EXT_meshopt_compression"];

let sharedIO = null;

/** Returns a NodeIO with every extension and the Draco and meshopt decoders registered. */
export const createModelIO = async () => {
  if (sharedIO) return sharedIO;
  await MeshoptDecoder.ready;
  sharedIO = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "meshopt.decoder": MeshoptDecoder,
  });
  return sharedIO;
};

/**
 * Optimises a glTF for Apricot. Removes duplicate and unused data, welds vertices and,
 * unless `options.quantize` is false, quantizes meshes.
 *
 * @param {Uint8Array | Document} input .glb bytes or a gltf-transform Document.
 * @param {{ quantize?: boolean }} [options]
 * @returns The optimised .glb bytes and a report with summaries before and after.
 */
export const optimizeModel = async (input, options = {}) => {
  const nodeIO = await createModelIO();
  const document = input instanceof Document ? input : await nodeIO.readBinary(input);
  const root = document.getRoot();
  const before = summarize(document);

  if (root.listExtensionsUsed().some((e) => e.extensionName === "KHR_texture_basisu")) {
    throw new Error(
      "KTX2/Basis textures are not supported on React Native (no WebAssembly). Use PNG or JPEG textures.",
    );
  }
  // Mesh data is decoded on read, so disposing the extensions writes it uncompressed.
  for (const extension of root.listExtensionsUsed()) {
    if (MESH_COMPRESSION.includes(extension.extensionName)) extension.dispose();
  }

  // Apps select parts and materials by name, so identical materials with different names stay separate.
  await document.transform(dedup({ keepUniqueNames: true }), prune(), weld());
  if (options.quantize !== false) await document.transform(quantize());
  const bytes = await nodeIO.writeBinary(document);
  const after = summarize(document);
  return { bytes, report: { before, after, byteLength: bytes.byteLength, warnings: budgetWarnings(after) } };
};

/** Limits for one hero model on a mid-range phone. `textureSide` is in pixels, `textureBytes` in bytes. */
export const BUDGET = { triangles: 150_000, textureSide: 2048, textureBytes: 8 * 1024 * 1024 };

/** Returns a warning for each way the summary exceeds BUDGET. Empty when it fits. */
export const budgetWarnings = (summary) => {
  const warnings = [];
  if (summary.triangles > BUDGET.triangles) {
    warnings.push(
      `${summary.triangles.toLocaleString("en")} triangles: more than ${BUDGET.triangles.toLocaleString("en")} is heavy for mid-range phones (reduce subdivision or decimate).`,
    );
  }
  const textureBytes = summary.textureList.reduce((sum, t) => sum + t.bytes, 0);
  if (textureBytes > BUDGET.textureBytes) {
    warnings.push(
      `${(textureBytes / 1048576).toFixed(1)} MB of textures: phones decode every texture at load.`,
    );
  }
  for (const t of summary.textureList) {
    if (t.width > BUDGET.textureSide || t.height > BUDGET.textureSide) {
      warnings.push(
        `Texture "${t.name}" is ${t.width}×${t.height}: ${BUDGET.textureSide} px is plenty on a phone.`,
      );
    }
  }
  return warnings;
};

/** Counts the meshes, materials, textures, vertices and triangles in a document. */
export const summarize = (document) => {
  const root = document.getRoot();
  let vertices = 0;
  let triangles = 0;
  /** @type {Map<import("@gltf-transform/core").Mesh, number>} */
  const meshTriangles = new Map();
  for (const mesh of root.listMeshes()) {
    let count = 0;
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")?.getCount() ?? 0;
      vertices += positions;
      // Only TRIANGLES primitives (mode 4) are counted.
      if (primitive.getMode() === 4) count += (primitive.getIndices()?.getCount() ?? positions) / 3;
    }
    meshTriangles.set(mesh, count);
  }
  const parts = root
    .listNodes()
    .filter((node) => node.getMesh())
    .map((node) => {
      const mesh = /** @type {import("@gltf-transform/core").Mesh} */ (node.getMesh());
      const count = meshTriangles.get(mesh) ?? 0;
      triangles += count;
      const materials = [...new Set(mesh.listPrimitives().map((p) => p.getMaterial()?.getName() ?? ""))];
      return { name: node.getName(), triangles: count, materials };
    });
  const textureList = root.listTextures().map((texture) => {
    const size = texture.getSize() ?? [0, 0];
    return {
      name: texture.getName() || texture.getURI() || "(unnamed)",
      mimeType: texture.getMimeType(),
      width: size[0],
      height: size[1],
      bytes: texture.getImage()?.byteLength ?? 0,
    };
  });
  return {
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    vertices,
    triangles,
    parts,
    materialNames: root.listMaterials().map((m) => m.getName()),
    textureList,
    animations: root.listAnimations().map((a) => a.getName()),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  };
};
