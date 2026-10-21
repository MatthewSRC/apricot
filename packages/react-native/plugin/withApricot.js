// Expo config plugin, enabled with `plugins: ["@apricotjs/react-native"]` in the app config.
// Applies the native settings that react-native-webgpu and Apricot need.
const {
  createRunOncePlugin,
  withGradleProperties,
  withInfoPlist,
  withPlugins,
} = require("expo/config-plugins");
const pkg = require("../package.json");

/** react-native-webgpu calls AHardwareBuffer APIs from Android 8.0 (API 26). */
const MIN_SDK_VERSION = 26;

/** Sets `android.minSdkVersion` to at least `min`, keeping a higher value. */
const raiseMinSdk = (properties, min = MIN_SDK_VERSION) => {
  const key = "android.minSdkVersion";
  const existing = properties.find((p) => p.type === "property" && p.key === key);
  if (!existing) return [...properties, { type: "property", key, value: String(min) }];
  if (Number(existing.value) < min) existing.value = String(min);
  return properties;
};

/** gradle.properties mod that raises `android.minSdkVersion`. */
const setMinSdk = (config) => {
  config.modResults = raiseMinSdk(config.modResults);
  return config;
};

/** Info.plist mod that lets CADisplayLink and requestAnimationFrame run at 120 Hz on ProMotion iPhones. */
const enableProMotion = (config) => {
  config.modResults.CADisableMinimumFrameDurationOnPhone = true;
  return config;
};

const withApricot = (config) =>
  withPlugins(config, [
    "react-native-webgpu",
    (c) => withGradleProperties(c, setMinSdk),
    (c) => withInfoPlist(c, enableProMotion),
  ]);

module.exports = createRunOncePlugin(withApricot, pkg.name, pkg.version);
module.exports.raiseMinSdk = raiseMinSdk;
module.exports.setMinSdk = setMinSdk;
module.exports.enableProMotion = enableProMotion;
