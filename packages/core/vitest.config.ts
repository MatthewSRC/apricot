import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    environment: "node",
    coverage: { ...coverage, exclude: [...coverage.exclude, "src/index.ts", "src/polyfills.ts"] },
  },
});
