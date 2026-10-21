// Shared steps for the scripts that export Apricot's procedural models as .glb files.
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optimizeModel } from "@apricotjs/metro/models";
import { build } from "rolldown";

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, ".cache");

/** The playground's model folder, assets/models. */
export const MODELS_DIR = path.join(here, "../assets/models");

// GLTFExporter reads its output Blob with FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

/**
 * Bundles a TypeScript module from packages/assets/src for Node, with three kept external, and imports it.
 * @param {string} name File name in packages/assets/src, such as "car.ts".
 */
export const importAssetModule = async (name) => {
  const file = path.join(cache, `${path.basename(name, path.extname(name))}.mjs`);
  await build({
    input: path.join(here, "../../../packages/assets/src", name),
    external: [/^three/],
    output: { file, format: "esm" },
    logLevel: "warn",
  });
  return import(file);
};

/** Removes the bundles written by importAssetModule. */
export const removeCache = () => rm(cache, { recursive: true, force: true });

/**
 * Exports an object as .glb bytes and optimises them with apricot-models.
 * @returns The bytes before and after optimisation, and the optimisation report.
 */
export const exportOptimizedGlb = async (object, animations = []) => {
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  const glb = await new GLTFExporter().parseAsync(object, { binary: true, animations });
  const { bytes, report } = await optimizeModel(new Uint8Array(glb));
  return { glb, bytes, report };
};

/** @param {number} bytes */
export const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
