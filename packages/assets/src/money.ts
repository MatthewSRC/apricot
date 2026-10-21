import { seededRandom } from "@apricotjs/core";
import { abs, color, length, min, mix, normalGeometry, smoothstep, step, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";

export interface BanknoteColors {
  base: THREE.ColorRepresentation;
  ink: THREE.ColorRepresentation;
  highlight: THREE.ColorRepresentation;
  paper: THREE.ColorRepresentation;
}

export const DEFAULT_BANKNOTE_COLORS: BanknoteColors = {
  base: "#7cc47f",
  ink: "#3f8f46",
  highlight: "#c8e6c9",
  paper: "#eef3e2",
};

type ColorNode = THREE.Node<"vec4">;

const tslColor = (value: THREE.ColorRepresentation) => color(new THREE.Color(value));

/**
 * A banknote material drawn in a shader without textures. Both faces have a dark border,
 * an inner frame line and a light oval. The edges use the paper colour, so a stack looks
 * like layered paper from the side.
 *
 * @param aspect Banknote width divided by depth.
 */
export const createBanknoteMaterial = (aspect: number, colors: Partial<BanknoteColors> = {}) => {
  const c = { ...DEFAULT_BANKNOTE_COLORS, ...colors };
  const p = uv();
  const edge = min(min(p.x, p.x.oneMinus()), min(p.y, p.y.oneMinus()));
  const border = smoothstep(0.07, 0.05, edge);
  const frameLine = smoothstep(0.105, 0.115, edge).mul(smoothstep(0.135, 0.125, edge));
  const oval = smoothstep(0.32, 0.3, length(vec2(p.x.sub(0.5).mul(aspect), p.y.sub(0.5))));
  const ink = tslColor(c.ink);
  const face = mix(mix(mix(tslColor(c.base), ink, border), ink, frameLine), tslColor(c.highlight), oval);
  const isFace = step(0.5, abs(normalGeometry.y));

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  material.colorNode = mix(tslColor(c.paper), face, isFace) as unknown as ColorNode;
  return material;
};

export interface MoneyStackOptions {
  /** Number of banknotes (default 40). */
  bills?: number;
  /** Seed for the random offsets of each bill, so a stack looks the same every time (default 1). */
  seed?: number;
  /** Banknote width along x (default 2.4). */
  width?: number;
  /** Banknote depth along z (default 1.05). */
  depth?: number;
  /** Thickness of one bill (default 0.022). */
  thickness?: number;
  /** Paper band around the middle, or its colour. `false` gives a loose stack (default true). */
  band?: boolean | THREE.ColorRepresentation;
  colors?: Partial<BanknoteColors>;
}

/**
 * A stack of banknotes drawn as one InstancedMesh, plus an optional paper band.
 * The base of the stack sits at y = 0.
 */
export const createMoneyStack = ({
  bills = 40,
  seed = 1,
  width = 2.4,
  depth = 1.05,
  thickness = 0.022,
  band = true,
  colors,
}: MoneyStackOptions = {}) => {
  const count = Math.max(1, Math.floor(bills));
  const group = new THREE.Group();
  group.name = "MoneyStack";

  const notes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(width, thickness, depth),
    createBanknoteMaterial(width / depth, colors),
    count,
  );
  notes.name = "MoneyStack:bills";
  const random = seededRandom(seed);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const step = thickness * 1.02;
  const shift = 0.03;
  const twist = 0.035;
  for (let i = 0; i < count; i++) {
    position.set((random() - 0.5) * 2 * shift, step * i + thickness / 2, (random() - 0.5) * 2 * shift);
    rotation.setFromAxisAngle(up, (random() - 0.5) * 2 * twist);
    notes.setMatrixAt(i, matrix.compose(position, rotation, scale));
  }
  notes.instanceMatrix.needsUpdate = true;
  group.add(notes);

  if (band !== false) {
    const height = step * count + 0.01;
    const bandWidth = width * 0.22;
    // Deep enough that no shifted or twisted bill pokes through the band.
    const reach = shift + Math.sin(twist) * (bandWidth / 2 + shift) + 0.006;
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(bandWidth, height, depth + 2 * reach),
      new THREE.MeshStandardNodeMaterial({ color: band === true ? "#e8c766" : band, roughness: 0.6 }),
    );
    strap.name = "MoneyStack:band";
    strap.position.y = height / 2;
    group.add(strap);
  }
  return group;
};

export interface CoinOptions {
  /** Default 0.5. */
  radius?: number;
  /** Default 0.08. */
  thickness?: number;
  /** Default gold, #f2c14e. */
  color?: THREE.ColorRepresentation;
}

/**
 * A gold coin lying flat with its axis along y, with an engraved ring on both faces.
 * It is only slightly metallic because a fully metallic surface needs an environment map,
 * and Apricot's looks use plain lights.
 */
export const createCoin = ({ radius = 0.5, thickness = 0.08, color: gold = "#f2c14e" }: CoinOptions = {}) => {
  const base = new THREE.Color(gold);
  const darker = base.clone().multiplyScalar(0.72);
  const p = uv();
  const r = length(p.sub(0.5));
  const ring = smoothstep(0.36, 0.38, r).mul(smoothstep(0.43, 0.41, r));
  const isFace = step(0.5, abs(normalGeometry.y));
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0.3, roughness: 0.38 });
  material.colorNode = mix(
    color(darker),
    mix(color(base), color(darker), ring),
    isFace,
  ) as unknown as ColorNode;

  const coin = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 48), material);
  coin.name = "Coin";
  return coin;
};
