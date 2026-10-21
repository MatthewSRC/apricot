// @ts-check

/**
 * Model file extensions that Metro bundles as assets, matching what <Model> can load.
 * A .gltf file must embed its buffers and images because a separate .bin cannot be resolved.
 */
const ASSET_EXTENSIONS = ["glb", "gltf"];

/**
 * Adds Apricot support to a Metro config: bundles .glb and .gltf files as assets and
 * resolves both "three" and "three/webgpu" to the WebGPU build of three.js.
 *
 * @example
 * const { getDefaultConfig } = require("expo/metro-config");
 * const { withApricot } = require("@apricotjs/metro");
 * module.exports = withApricot(getDefaultConfig(__dirname));
 *
 * @param {import("metro-config").MetroConfig & { projectRoot: string, resolver: any }} config
 */
function withApricot(config) {
  // Addons import bare "three". Sending it to the WebGPU build keeps a single copy of three in the bundle.
  // three does not export "./package.json", so the entry point is resolved directly.
  const threeWebGPU = require.resolve("three/webgpu", { paths: [config.projectRoot] });

  const assetExts = config.resolver.assetExts ?? [];
  const previousResolve = config.resolver.resolveRequest;

  return {
    ...config,
    resolver: {
      ...config.resolver,
      assetExts: [...assetExts, ...ASSET_EXTENSIONS.filter((ext) => !assetExts.includes(ext))],
      /** @type {(context: any, moduleName: string, platform: string | null) => any} */
      resolveRequest: (context, moduleName, platform) => {
        if (moduleName === "three" || moduleName === "three/webgpu") {
          return { filePath: threeWebGPU, type: "sourceFile" };
        }
        return previousResolve
          ? previousResolve(context, moduleName, platform)
          : context.resolveRequest(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withApricot, ASSET_EXTENSIONS };
