import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRDracoMeshCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptEncoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";
import { loadTools, run } from "../cli.mjs";
import { BUDGET, budgetWarnings, createModelIO, optimizeModel, summarize } from "../models.mjs";

/**
 * A document with two copies of one triangle grid and two identical materials
 * (named alike unless `names` are given).
 */
const makeDocument = (names: [string, string] = ["paint", "paint"]) => {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = 20;
  const positions: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) positions.push(x / n, y / n, 0);
  const indices: number[] = [];
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      indices.push(i, i + 1, i + n, i + 1, i + n + 1, i + n);
    }
  const scene = doc.createScene();
  for (let k = 0; k < 2; k++) {
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(positions))
      .setBuffer(buffer);
    const index = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer);
    const material = doc.createMaterial(names[k]).setBaseColorFactor([1, 0, 0, 1]);
    const primitive = doc
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setIndices(index)
      .setMaterial(material);
    const mesh = doc.createMesh(`mesh${k}`).addPrimitive(primitive);
    scene.addChild(doc.createNode(k === 0 ? "wheel_fl" : "body").setMesh(mesh));
  }
  return doc;
};

describe("optimizeModel", () => {
  it("dedups, quantizes and keeps node names", async () => {
    const { bytes, report } = await optimizeModel(makeDocument());
    expect(report.before.materials).toBe(2);
    expect(report.after.materials).toBe(1);
    // Meshes with different names stay apart (apps select parts by name).
    expect(report.after.meshes).toBe(2);
    expect(report.after.extensions).toContain("KHR_mesh_quantization");
    const io = await createModelIO();
    const back = await io.readBinary(bytes);
    expect(
      back
        .getRoot()
        .listNodes()
        .map((node) => node.getName()),
    ).toEqual(["wheel_fl", "body"]);
    const unquantized = await optimizeModel(makeDocument(), { quantize: false });
    expect(unquantized.report.after.extensions).not.toContain("KHR_mesh_quantization");
    expect(unquantized.bytes.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("keeps identical materials apart when their names differ (apps select by name)", async () => {
    const { report } = await optimizeModel(makeDocument(["car_paint", "Vernice"]));
    expect(report.after.materials).toBe(2);
    expect(report.after.materialNames).toEqual(["car_paint", "Vernice"]);
  });

  it("summarises parts, triangles and textures, and warns past the phone budget", async () => {
    const doc = makeDocument();
    const summary = summarize(doc);
    expect(summary.triangles).toBe(2 * 19 * 19 * 2);
    expect(summary.parts.map((p) => p.name)).toEqual(["wheel_fl", "body"]);
    expect(summary.parts[0].materials).toEqual(["paint"]);
    expect(budgetWarnings(summary)).toEqual([]);
    const heavy = { ...summary, triangles: BUDGET.triangles + 1 };
    expect(budgetWarnings(heavy)[0]).toMatch(/triangles/);
    const textured = {
      ...summary,
      textureList: [
        { name: "stripes", mimeType: "image/png", width: 4096, height: 4096, bytes: 9 * 1024 * 1024 },
      ],
    };
    const warnings = budgetWarnings(textured);
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toMatch(/MB of textures/);
    expect(warnings.join(" ")).toMatch(/4096×4096/);
  });

  it("reads .glb bytes and decodes Draco and meshopt inputs", async () => {
    const io = await createModelIO();
    await MeshoptEncoder.ready;
    io.registerDependencies({
      "draco3d.encoder": await draco3d.createEncoderModule(),
      "meshopt.encoder": MeshoptEncoder,
    });
    const draco = makeDocument();
    draco.createExtension(KHRDracoMeshCompression).setRequired(true);
    const meshopt = makeDocument();
    meshopt.createExtension(EXTMeshoptCompression).setRequired(true);
    for (const doc of [draco, meshopt]) {
      const compressed = await io.writeBinary(doc);
      expect(summarize(await io.readBinary(compressed)).extensions.length).toBe(1);
      const { report } = await optimizeModel(compressed);
      expect(report.after.extensions).toEqual(["KHR_mesh_quantization"]);
      expect(report.after.vertices).toBeGreaterThanOrEqual(400);
    }
  });

  it("rejects KTX2 / Basis textures", async () => {
    const doc = makeDocument();
    doc.createExtension(KHRTextureBasisu);
    await expect(optimizeModel(doc)).rejects.toThrow(/KTX2/);
  });
});

describe("apricot-models CLI", () => {
  it("optimises files and folders into an output folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apricot-models-"));
    const io = await createModelIO();
    await writeFile(path.join(dir, "car.glb"), await io.writeBinary(makeDocument()));
    await io.write(path.join(dir, "tree.gltf"), makeDocument());
    await writeFile(path.join(dir, "notes.txt"), "not a model");
    const lines: string[] = [];
    const out = path.join(dir, "out");
    expect(await run([dir, "-o", out], (line) => lines.push(line))).toBe(0);
    expect(lines.some((l) => l.startsWith("car.glb:") && l.includes("→"))).toBe(true);
    expect(lines.some((l) => l.startsWith("tree.gltf:"))).toBe(true);
    expect((await readFile(path.join(out, "car.glb"))).byteLength).toBeGreaterThan(0);
    expect((await readFile(path.join(out, "tree.glb"))).byteLength).toBeGreaterThan(0);
    // A single file, written next to itself.
    expect(await run([path.join(out, "car.glb")], () => {})).toBe(0);
  });

  it("inspects a model: parts, materials, textures, animations and warnings, or JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "apricot-models-"));
    const io = await createModelIO();
    const doc = makeDocument(["car_paint", "glass"]);
    const texture = doc
      .createTexture("stripes")
      .setMimeType("image/png")
      // A 1×1 PNG: inspect reads its size from the header.
      .setImage(
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          ),
          (c) => c.charCodeAt(0),
        ),
      );
    doc.getRoot().listMaterials()[0].setBaseColorTexture(texture);
    doc.createAnimation("DoorOpen");
    const file = path.join(dir, "car.glb");
    await writeFile(file, await io.writeBinary(doc));
    const lines: string[] = [];
    expect(await run(["inspect", file], (l) => lines.push(l))).toBe(0);
    const text = lines.join("\n");
    expect(text).toMatch(/car\.glb: 1,444 triangles, 2 parts, 2 materials, 1 textures/);
    expect(text).toMatch(/wheel_fl · 722 · car_paint/);
    expect(text).toMatch(/glass \(1 part\)/);
    expect(text).toMatch(/stripes · 1×1 image\/png/);
    expect(text).toMatch(/Animations: DoorOpen/);
    const json: string[] = [];
    expect(await run(["inspect", "--json", file], (l) => json.push(l))).toBe(0);
    expect(JSON.parse(json[0]).materialNames).toEqual(["car_paint", "glass"]);
    const gltfPath = path.join(dir, "plain.gltf");
    await io.write(gltfPath, makeDocument());
    const plain: string[] = [];
    expect(await run(["inspect", gltfPath], (l) => plain.push(l))).toBe(0);
    expect(plain.join("\n")).not.toMatch(/Textures|Animations/);
    expect(await run(["inspect"], () => {})).toBe(1);
  });

  it("says which model tools to install when they are missing", async () => {
    const lines: string[] = [];
    const missing = Object.assign(new Error("Cannot find package '@gltf-transform/core'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(
      await loadTools(
        (l) => lines.push(l),
        () => Promise.reject(missing),
      ),
    ).toBeNull();
    expect(lines[0]).toBe(
      "apricot-models needs the model tools: npm install --save-dev @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf meshoptimizer",
    );
    // Any other failure is not about installing.
    await expect(
      loadTools(
        () => {},
        () => Promise.reject(new Error("broken")),
      ),
    ).rejects.toThrow("broken");
    expect(await loadTools(() => {})).not.toBeNull();
  });

  it("prints usage and reports failures", async () => {
    const lines: string[] = [];
    expect(await run([], (l) => lines.push(l))).toBe(1);
    expect(await run(["--help"], (l) => lines.push(l))).toBe(0);
    expect(await run(["x.glb", "-o"], (l) => lines.push(l))).toBe(1);
    expect(lines.every((l) => l.startsWith("Usage"))).toBe(true);
    // Optimising a heavy model prints the budget warnings.
    const heavyDir = await mkdtemp(path.join(tmpdir(), "apricot-models-"));
    const io = await createModelIO();
    const big = makeDocument();
    const buffer = big.getRoot().listBuffers()[0];
    const n = 300;
    const positions: number[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) positions.push(x, y, 0);
    const indices: number[] = [];
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        const i = y * n + x;
        indices.push(i, i + 1, i + n, i + 1, i + n + 1, i + n);
      }
    const primitive = big
      .createPrimitive()
      .setAttribute(
        "POSITION",
        big.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
      )
      .setIndices(
        big.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer),
      );
    big
      .getRoot()
      .listScenes()[0]
      .addChild(big.createNode("dense").setMesh(big.createMesh("dense").addPrimitive(primitive)));
    await writeFile(path.join(heavyDir, "dense.glb"), await io.writeBinary(big));
    const heavyLines: string[] = [];
    await run([path.join(heavyDir, "dense.glb")], (l) => heavyLines.push(l));
    expect(heavyLines.join("\n")).toMatch(/ {2}! .*triangles/);
    const dir = await mkdtemp(path.join(tmpdir(), "apricot-models-"));
    await writeFile(path.join(dir, "broken.glb"), "nope");
    const errors: string[] = [];
    expect(await run([path.join(dir, "broken.glb")], (l) => errors.push(l))).toBe(1);
    expect(errors[0]).toMatch(/^broken\.glb: /);
  });
});
