import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.shared.mjs";

export default defineConfig({
  resolve: {
    // Components render through react-native-web in jsdom.
    alias: { "react-native": "react-native-web" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      ...coverage,
      include: [...coverage.include, "plugin/**"],
      exclude: [...coverage.exclude, "src/index.ts"],
    },
  },
});
