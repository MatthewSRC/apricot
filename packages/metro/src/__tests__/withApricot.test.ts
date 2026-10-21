import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { withApricot } = require("../index.js") as typeof import("../index");

const projectRoot = path.resolve(__dirname, "../../../../apps/playground");

describe("withApricot", () => {
  const base = {
    projectRoot,
    resolver: {
      assetExts: ["png", "glb"],
      resolveRequest: undefined as undefined | ((...args: unknown[]) => unknown),
    },
  };

  it("adds model formats as assets without duplicates", () => {
    const config = withApricot(base) as typeof base;
    expect(config.resolver.assetExts.filter((e) => e === "glb")).toHaveLength(1);
    expect(config.resolver.assetExts).toContain("gltf");
    // Only what <Model> can load: no separate .bin buffers, HDR or KTX2 images.
    for (const ext of ["bin", "hdr", "ktx2"]) expect(config.resolver.assetExts).not.toContain(ext);
  });

  it("sends bare three and three/webgpu to the WebGPU build", () => {
    const config = withApricot(base) as typeof base;
    const fallback = { resolveRequest: () => ({ type: "fallback" }) };
    const resolve = config.resolver.resolveRequest as (
      c: unknown,
      m: string,
      p: string,
    ) => { filePath?: string };
    expect(resolve(fallback, "three", "ios").filePath).toMatch(/three\.webgpu\.js$/);
    expect(resolve(fallback, "three/webgpu", "ios").filePath).toMatch(/three\.webgpu\.js$/);
    expect(resolve(fallback, "three/tsl", "ios")).toEqual({ type: "fallback" });
  });

  it("works when Metro has no asset extensions yet", () => {
    const config = withApricot({ projectRoot, resolver: {} }) as unknown as {
      resolver: { assetExts: string[] };
    };
    expect(config.resolver.assetExts).toEqual(["glb", "gltf"]);
  });

  it("keeps an existing custom resolver", () => {
    const custom = () => ({ type: "custom" });
    const config = withApricot({
      ...base,
      resolver: { ...base.resolver, resolveRequest: custom },
    }) as typeof base;
    const resolve = config.resolver.resolveRequest as (c: unknown, m: string, p: string) => unknown;
    expect(resolve({}, "lodash", "ios")).toEqual({ type: "custom" });
  });
});
