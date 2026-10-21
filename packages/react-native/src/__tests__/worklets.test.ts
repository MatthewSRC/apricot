import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const { transformSync } = require("@babel/core") as {
  transformSync: (code: string, options: object) => { code?: string | null } | null;
};

/** `file` (in src) as the app's Babel makes it, with the worklets plugin that moves code to the UI thread. */
const compiled = (file: string) => {
  const path = join(__dirname, "..", file);
  return (
    transformSync(readFileSync(path, "utf8"), {
      filename: path,
      babelrc: false,
      configFile: false,
      presets: [[require.resolve("@babel/preset-typescript"), { isTSX: true, allExtensions: true }]],
      plugins: [require.resolve("react-native-worklets/plugin")],
    })?.code ?? ""
  );
};

/** What each worklet in `code` takes with it to the UI thread: the names in its closure. */
const closures = (code: string) =>
  [...code.matchAll(/\.__closure = \{([^}]*)\}/g)].map((m) =>
    m[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );

describe("code that runs on the UI thread", () => {
  // Every callback passed to Reanimated must be a worklet; on native, a plain function crashes the app.
  it.each([
    ["animatable.ts", 2],
    ["Label.tsx", 1],
  ])("%s: its %i callbacks are worklets, carrying no modules", (file, count) => {
    const code = compiled(file);
    const carried = closures(code);
    expect(carried).toHaveLength(count);
    for (const names of carried) expect(names).not.toContain("optional");
  });
});
