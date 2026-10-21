// Builds assets/models/car.glb from Apricot's procedural toy car, exported to glTF and optimised
// with apricot-models. The Drive scene loads it with <Model>.
// Run: pnpm --filter playground make-car
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportOptimizedGlb, importAssetModule, kb, MODELS_DIR, removeCache } from "./procedural-models.mjs";

const out = path.join(MODELS_DIR, "car.glb");

const THREE = await import("three/webgpu");
const { createCar } = await importAssetModule("car.ts");

const car = createCar();
// A plain glTF material, the same kind that the app's GLTFLoader creates.
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
car.traverse((object) => {
  if (object.isMesh) object.material = material;
});
const { glb, bytes, report } = await exportOptimizedGlb(car);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, bytes);
await removeCache();
console.log(`car.glb: ${kb(glb.byteLength)} → ${kb(bytes.byteLength)}`, report.after);
