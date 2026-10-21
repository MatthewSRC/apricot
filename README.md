# Apricot

A 3D engine for Expo apps on iOS and Android: React components for scenes,
shapes, models, cameras, lights and motion, rendered with three.js on
WebGPU (react-native-webgpu).

Documentation: https://matthiasbrandolin.dev/apricot

## Packages

| Package | Contents |
| --- | --- |
| `@apricotjs/react-native` | Components and hooks (`@apricotjs/react-native/model`, `/capture` and `/mock` are separate entries) |
| `@apricotjs/core` | The engine underneath, without React |
| `@apricotjs/assets` | Ready-made objects: fruit, coins, cards, cars, trees, ground |
| `@apricotjs/metro` | Metro config and the `apricot-models` model optimiser |

## Install

```sh
npx expo install @apricotjs/react-native @apricotjs/core react-native-webgpu three
npm install -D @apricotjs/metro @types/three @webgpu/types
```

```js
// app.json / app.config.js
plugins: ["@apricotjs/react-native"]

// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withApricot } = require("@apricotjs/metro");
module.exports = withApricot(getDefaultConfig(__dirname));
```

Apricot needs a development build; Expo Go is not supported.

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

## Develop

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm bundle-size
```

`apps/playground` is an Expo app with a scene for each feature. Run it on a
device with a development build:

```sh
cd apps/playground
npx expo prebuild
npm run ios:release      # or android:release
```

## License

MIT
