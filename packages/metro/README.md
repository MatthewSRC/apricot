# @apricotjs/metro

Metro config for apps using Apricot, and `apricot-models`, a command that optimises glTF models.

```sh
npm install -D @apricotjs/metro
```

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withApricot } = require("@apricotjs/metro");
module.exports = withApricot(getDefaultConfig(__dirname));
```

The model command needs the glTF tools:

```sh
npm install -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf meshoptimizer
npx apricot-models assets/models/chair.glb -o assets/models/optimised
npx apricot-models inspect assets/models/chair.glb
```

Documentation: https://matthiasbrandolin.dev/apricot

## License

MIT
