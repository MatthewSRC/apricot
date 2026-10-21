module.exports = {
  expo: {
    name: "Apricot Playground",
    slug: "apricot-playground",
    scheme: "apricot-playground",
    version: "0.0.0",
    orientation: "portrait",
    ios: { bundleIdentifier: "dev.apricot.playground" },
    android: { package: "dev.apricot.playground" },
    // @apricotjs/react-native applies react-native-webgpu's plugin, Android minSdk 26 and iOS 120 Hz.
    plugins: ["expo-router", "@apricotjs/react-native"],
  },
};
