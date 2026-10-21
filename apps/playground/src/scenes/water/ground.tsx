import { Box, Group, type Outline, type SceneObject, Slab, Sphere, Terrain } from "@apricotjs/react-native";
import { memo } from "react";

// A square of sea with a sandbank in it, cut out like a tile, and a deck on the sand.

export const TILE = { width: 7, depth: 5 };
/** Heights of the dry sand and the water. FLOOR is the sea floor at the tile's edge. */
export const SAND = 0.16;
export const SEA = 0;
const FLOOR = -0.45;
export const BOUNDS = [-TILE.width / 2, -TILE.depth / 2, TILE.width / 2, TILE.depth / 2] as const;

// The sandbank is an ellipse; `reach` is 1 at its dry edge and grows outwards.
const BANK = { x: 1.1, z: -0.3, rx: 2.3, rz: 1.65 };
const reach = (x: number, z: number) => Math.hypot((x - BANK.x) / BANK.rx, (z - BANK.z) / BANK.rz);
const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Ground height: dry sand on the bank sloping down to the sea floor. */
export const groundAt = (x: number, z: number) => {
  const ripple = 0.01 * Math.sin(x * 1.7 + z * 0.6) * Math.cos(z * 1.3 - x * 0.4);
  return FLOOR + (SAND - FLOOR) * smooth((1.35 - reach(x, z)) / 0.5) + ripple;
};
export const isLand = (x: number, z: number) => groundAt(x, z) > SEA;

export const rect = ({
  minX,
  minZ,
  maxX,
  maxZ,
}: {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}): Outline => [
  [minX, minZ],
  [maxX, minZ],
  [maxX, maxZ],
  [minX, maxZ],
];

/** The dry sand that pieces stand on. */
export const DRY_SAND: Outline = Array.from({ length: 32 }, (_, i): [number, number] => {
  const a = (i / 32) * Math.PI * 2;
  return [BANK.x + 0.8 * BANK.rx * Math.cos(a), BANK.z + 0.8 * BANK.rz * Math.sin(a)];
});

/** The deck on the sand, and its top. */
export const DECK = { minX: 1.3, maxX: 2.75, minZ: -1.1, maxZ: 0.3, top: SAND + 0.08 };
/** Rocks on the sand that nothing can stand on. */
export const ROCKS = { x: -0.15, z: 0.35, radius: 0.32 };

const sandAt = (_x: number, _z: number, y: number) =>
  y > 0.07 ? "#f3dcae" : y > -0.03 ? "#e3c48e" : "#e8cf9d";
const layerAt = (y: number) => (y > -0.12 ? "#f0d9aa" : y > -0.38 ? "#e6c693" : "#dbb582");

export const Ground = memo(function Ground({ onTile }: { onTile: (tile: SceneObject | null) => void }) {
  return (
    <Group ref={onTile}>
      <Box
        size={[TILE.width + 0.16, 0.14, TILE.depth + 0.16]}
        position={[0, FLOOR - 0.27, 0]}
        radius={0.03}
        color="#f6f1eb"
      />
      <Terrain
        size={[TILE.width, TILE.depth]}
        height={groundAt}
        spacing={0.1}
        base={FLOOR - 0.2}
        color={sandAt}
        sides={layerAt}
        water={{ level: SEA, top: "#79dfe0", deep: "#2a92cf", fade: 0.45, clarity: 0.2 }}
      />
      <Slab
        outline={rect(DECK)}
        height={DECK.top - SAND + 0.02}
        position={[0, SAND - 0.02, 0]}
        color="#c9825a"
      />
      <Group position={[ROCKS.x, SAND, ROCKS.z]}>
        <Sphere radius={0.2} position={[0, 0.06, 0]} scale={[1.2, 0.7, 1]} color="#a9a39b" />
        <Sphere radius={0.13} position={[0.2, 0.03, 0.12]} scale={[1, 0.7, 1.1]} color="#bdb7ae" />
      </Group>
    </Group>
  );
});
