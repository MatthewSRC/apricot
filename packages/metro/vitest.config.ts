import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.shared.mjs";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    coverage: { ...coverage, include: ["src/index.js", "src/models.mjs", "src/cli.mjs"] },
  },
});
