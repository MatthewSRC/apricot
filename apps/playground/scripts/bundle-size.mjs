// Exports the playground for Android and checks the Hermes bytecode size
// against bundle-budget.json. `--update` rewrites the budget to the current
// size plus 5% headroom.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist/bundle-size");
const budgetFile = path.join(root, "bundle-budget.json");

rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["expo", "export", "--platform", "android", "--output-dir", out], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
});

const dir = path.join(out, "_expo/static/js/android");
const hbc = readdirSync(dir).find((f) => f.endsWith(".hbc"));
if (!hbc) throw new Error(`no .hbc bundle in ${dir}`);
const bytes = statSync(path.join(dir, hbc)).size;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (process.argv.includes("--update")) {
  const budget = Math.ceil((bytes * 1.05) / 1024) * 1024;
  writeFileSync(budgetFile, `${JSON.stringify({ androidHbcBytes: budget }, null, 2)}\n`);
  console.log(`android bundle ${kb(bytes)}; budget set to ${kb(budget)}`);
} else {
  const { androidHbcBytes } = JSON.parse(readFileSync(budgetFile, "utf8"));
  console.log(`android bundle ${kb(bytes)} / budget ${kb(androidHbcBytes)}`);
  if (bytes > androidHbcBytes) {
    console.error("Bundle is over budget. If the growth is intended, run `pnpm bundle-size --update`.");
    process.exit(1);
  }
}
