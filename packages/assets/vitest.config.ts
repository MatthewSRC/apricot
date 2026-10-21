import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.shared.mjs";

export default defineConfig({
  resolve: { alias: { "react-native": "react-native-web" } },
  test: {
    environment: "jsdom",
    // Same native-module doubles as @apricotjs/react-native.
    setupFiles: ["../react-native/src/__tests__/setup.ts"],
    coverage: { ...coverage, exclude: [...coverage.exclude, "src/index.ts"] },
  },
});
