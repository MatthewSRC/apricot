# @apricotjs/react-native

React Native components and hooks for Apricot, a 3D engine for Expo apps on iOS and Android, rendered with three.js on WebGPU.

Documentation: https://matthiasbrandolin.dev/apricot

## Install

```sh
npx expo install @apricotjs/react-native @apricotjs/core react-native-webgpu three
npm install -D @apricotjs/metro @types/three @webgpu/types
```

Add the plugin to the app config and the Metro config:

```js
// app.json / app.config.js
plugins: ["@apricotjs/react-native"]

// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withApricot } = require("@apricotjs/metro");
module.exports = withApricot(getDefaultConfig(__dirname));
```

Apricot needs a development build; Expo Go is not supported.

## Example

```tsx
import { Box, Scene, Spin } from "@apricotjs/react-native";

export function Cube() {
  return (
    <Scene style={{ flex: 1 }}>
      <Spin speed={1}>
        <Box size={1.6} color="#ff9f59" />
      </Spin>
    </Scene>
  );
}
```

`@apricotjs/react-native/model` loads glTF models, `/capture` saves pictures of a scene, and `/mock` replaces the package in Jest tests.

## License

MIT
