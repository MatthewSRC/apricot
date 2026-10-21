// Builds assets/models/sedan.glb and laptop.glb from Apricot's procedural showroom models, with named
// parts, named materials and a "LidOpen" animation for the laptop, optimised with apricot-models.
// The Showroom and Laptop scenes load them.
// Run: pnpm --filter playground make-showroom
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportOptimizedGlb, importAssetModule, kb, MODELS_DIR, removeCache } from "./procedural-models.mjs";

const THREE = await import("three/webgpu");
const { createLaptop, createLaptopAnimation, createSedan } = await importAssetModule("showroom.ts");

// Replaces node materials with plain glTF materials of the same name and values, the kind the app's
// GLTFLoader creates.
const withPlainMaterials = (root) => {
  const converted = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const m = object.material;
    if (!converted.has(m)) {
      converted.set(
        m,
        new THREE.MeshStandardMaterial({
          name: m.name,
          color: m.color,
          roughness: m.roughness,
          metalness: m.metalness,
          emissive: m.emissive,
          emissiveIntensity: m.emissiveIntensity,
        }),
      );
    }
    object.material = converted.get(m);
  });
  return root;
};

const write = async (name, object, animations = []) => {
  const { glb, bytes, report } = await exportOptimizedGlb(withPlainMaterials(object), animations);
  await writeFile(path.join(MODELS_DIR, name), bytes);
  console.log(`${name}: ${kb(glb.byteLength)} → ${kb(bytes.byteLength)}`, {
    triangles: report.after.triangles,
    parts: report.after.parts.length,
    materials: report.after.materialNames,
    animations: report.after.animations,
  });
};

await mkdir(MODELS_DIR, { recursive: true });
await write("sedan.glb", createSedan());
await write("laptop.glb", createLaptop(), [createLaptopAnimation()]);
await removeCache();
