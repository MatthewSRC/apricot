import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Property = { type: string; key: string; value: string };
const plugin = require("../../plugin/withApricot") as ((config: object) => Record<string, unknown>) & {
  raiseMinSdk: (p: Property[], min?: number) => Property[];
  setMinSdk: (c: { modResults: Property[] }) => { modResults: Property[] };
  enableProMotion: (c: { modResults: Record<string, unknown> }) => { modResults: Record<string, unknown> };
};

describe("config plugin", () => {
  it("adds android.minSdkVersion when missing", () => {
    expect(plugin.raiseMinSdk([])).toEqual([{ type: "property", key: "android.minSdkVersion", value: "26" }]);
  });

  it("raises a lower value and keeps a higher one", () => {
    expect(
      plugin.raiseMinSdk([{ type: "property", key: "android.minSdkVersion", value: "24" }])[0].value,
    ).toBe("26");
    expect(
      plugin.raiseMinSdk([{ type: "property", key: "android.minSdkVersion", value: "29" }])[0].value,
    ).toBe("29");
  });

  it("gradle.properties mod sets the minimum", () => {
    expect(plugin.setMinSdk({ modResults: [] }).modResults[0].value).toBe("26");
  });

  it("Info.plist mod enables 120 Hz", () => {
    expect(plugin.enableProMotion({ modResults: {} }).modResults).toEqual({
      CADisableMinimumFrameDurationOnPhone: true,
    });
  });

  it("registers Android and iOS mods on an app config", () => {
    const config = plugin({ name: "app", slug: "app", _internal: { projectRoot: process.cwd() } }) as {
      mods?: { android?: object; ios?: object };
    };
    expect(Object.keys(config.mods?.android ?? {})).toContain("gradleProperties");
    expect(Object.keys(config.mods?.ios ?? {})).toContain("infoPlist");
  });
});
