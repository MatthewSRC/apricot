# @apricotjs/assets

Ready-made objects for Apricot: fruit, coins and money, cards, cars, trees and ground.

```sh
npx expo install @apricotjs/assets
```

```tsx
import { Scene } from "@apricotjs/react-native";
import { Apple, Ground } from "@apricotjs/assets";

<Scene style={{ flex: 1 }}>
  <Ground />
  <Apple position={[0, 0.5, 0]} />
</Scene>;
```

Documentation: https://matthiasbrandolin.dev/apricot

## License

MIT
