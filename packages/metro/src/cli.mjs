#!/usr/bin/env node
// apricot-models optimises .glb and .gltf files for Apricot.
//
//   apricot-models <file-or-folder>... [-o <out-folder>]
//     Writes each input as <name>.glb to the output folder, or next to the input when -o is omitted.
//   apricot-models inspect <file> [--json]
//     Lists the model's parts, materials, triangles, textures, animations and budget warnings.
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Optional peer dependencies that the model tools need. */
export const TOOLS = [
  "@gltf-transform/core",
  "@gltf-transform/extensions",
  "@gltf-transform/functions",
  "draco3dgltf",
  "meshoptimizer",
];
/**
 * Imports models.mjs. Returns null and logs an install command when one of TOOLS is missing.
 * @param {(line: string) => void} log
 * @param {() => Promise<typeof import("./models.mjs")>} [load]
 */
export const loadTools = async (log, load = () => import("./models.mjs")) => {
  try {
    return await load();
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code !== "ERR_MODULE_NOT_FOUND") throw error;
    log(`apricot-models needs the model tools: npm install --save-dev ${TOOLS.join(" ")}`);
    return null;
  }
};

const USAGE =
  "Usage: apricot-models <file-or-folder>... [-o <out-folder>]\n       apricot-models inspect <file> [--json]";

/** @param {number} bytes */
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/** @param {string} file */
const isGltf = (file) => file.toLowerCase().endsWith(".gltf");

/**
 * Expands folders into the .glb and .gltf files they contain.
 * @param {string[]} inputs
 */
const listModelFiles = async (inputs) => {
  /** @type {string[]} */
  const files = [];
  for (const input of inputs) {
    if ((await stat(input)).isDirectory()) {
      for (const name of await readdir(input))
        if (/\.(glb|gltf)$/i.test(name)) files.push(path.join(input, name));
    } else files.push(input);
  }
  return files;
};

/**
 * Runs the CLI and returns its exit code.
 * @param {string[]} args Command-line arguments without the node and script paths.
 * @param {(line: string) => void} [log] Receives each output line. Defaults to console.log.
 */
export const run = async (args, log = console.log) => {
  if (args[0] === "inspect") return inspect(args.slice(1), log);
  /** @type {string[]} */
  const inputs = [];
  // Stays null without -o. Becomes undefined when -o is the last argument.
  /** @type {string | null | undefined} */
  let outDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--out") outDir = args[++i];
    else if (args[i] === "-h" || args[i] === "--help") {
      log(USAGE);
      return 0;
    } else inputs.push(args[i]);
  }
  if (inputs.length === 0 || outDir === undefined) {
    log(USAGE);
    return 1;
  }
  const files = await listModelFiles(inputs);
  const tools = await loadTools(log);
  if (!tools) return 1;
  const { createModelIO, optimizeModel } = tools;
  if (outDir) await mkdir(outDir, { recursive: true });
  const io = await createModelIO();
  let failed = 0;
  for (const file of files) {
    try {
      const input = isGltf(file) ? await io.read(file) : new Uint8Array(await readFile(file));
      const { bytes, report } = await optimizeModel(input);
      const out = path.join(outDir ?? path.dirname(file), `${path.basename(file, path.extname(file))}.glb`);
      // The input is measured before writing because the output may replace it.
      const size = file.toLowerCase().endsWith(".glb") ? `${kb((await stat(file)).size)} → ` : "";
      await writeFile(out, bytes);
      log(
        `${path.basename(file)}: ${size}${kb(report.byteLength)}, ${report.after.vertices} vertices → ${out}`,
      );
      for (const warning of report.warnings) log(`  ! ${warning}`);
    } catch (error) {
      failed++;
      log(`${path.basename(file)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return failed ? 1 : 0;
};

/**
 * Prints the parts, materials, textures, animations and budget warnings of a model.
 * @param {string[]} args
 * @param {(line: string) => void} log
 */
const inspect = async (args, log) => {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    log(USAGE);
    return 1;
  }
  const tools = await loadTools(log);
  if (!tools) return 1;
  const { budgetWarnings, createModelIO, summarize } = tools;
  const io = await createModelIO();
  const document = isGltf(file)
    ? await io.read(file)
    : await io.readBinary(new Uint8Array(await readFile(file)));
  const summary = summarize(document);
  const warnings = budgetWarnings(summary);
  if (args.includes("--json")) {
    log(JSON.stringify({ ...summary, warnings }, null, 2));
    return 0;
  }
  log(
    `${path.basename(file)}: ${summary.triangles.toLocaleString("en")} triangles, ${summary.parts.length} parts, ${summary.materials} materials, ${summary.textures} textures`,
  );
  log("\nParts (name · triangles · materials), heaviest first:");
  for (const part of [...summary.parts].sort((a, b) => b.triangles - a.triangles)) {
    log(`  ${part.name} · ${part.triangles.toLocaleString("en")} · ${part.materials.join(", ")}`);
  }
  log("\nMaterials:");
  for (const name of summary.materialNames) {
    const users = summary.parts.filter((p) => p.materials.includes(name)).length;
    log(`  ${name} (${users} part${users === 1 ? "" : "s"})`);
  }
  if (summary.textureList.length) {
    log("\nTextures:");
    for (const t of summary.textureList)
      log(`  ${t.name} · ${t.width}×${t.height} ${t.mimeType} · ${kb(t.bytes)}`);
  }
  if (summary.animations.length) log(`\nAnimations: ${summary.animations.join(", ")}`);
  for (const warning of warnings) log(`! ${warning}`);
  return 0;
};

// Runs when started as a program, including through the node_modules/.bin symlink.
/* c8 ignore next 3 */
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
