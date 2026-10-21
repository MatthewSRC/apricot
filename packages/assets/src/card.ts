import { PresetMaterial } from "@apricotjs/core";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { abs, fract, mix, normalGeometry, positionGeometry, smoothstep, step, vec2, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";

type ColorNode = THREE.Node<"vec4">;

/**
 * Card size in scene units, where 1 unit is 25.4 mm. Width and height follow ISO/IEC 7810 ID-1
 * (85.6 × 53.98 mm) and the thickness is 0.8 mm, as for a metal card.
 */
export const CARD_SIZE = { width: 3.37, height: 2.125, thickness: 0.032, radius: 0.125 } as const;

export type CardFinish =
  | "brushed-steel"
  | "chrome"
  | "gold"
  | "rose-gold"
  | "matte-black"
  | "glossy-paint"
  | "glass";

interface Surface {
  color: THREE.ColorRepresentation;
  metalness: number;
  roughness: number;
}

export interface FinishSpec extends Surface {
  label: string;
  /** The material preset the finish is built on (see definePreset). */
  preset: string;
  /** Extra physical-material settings for the card. */
  physical?: Partial<THREE.MeshPhysicalNodeMaterialParameters>;
  /** What the engraved artwork looks like on this finish. */
  engraving: Surface;
}

/**
 * The card finishes: four metals, a matte and a glossy dielectric, and glass. Each finish is a
 * material preset with card-specific settings, so the same looks are available for any object
 * through the presets.
 */
export const CARD_FINISHES: Record<CardFinish, FinishSpec> = {
  "brushed-steel": {
    label: "Brushed steel",
    preset: "brushed-metal",
    color: "#c9cdd3",
    metalness: 1,
    roughness: 0.3,
    engraving: { color: "#6f737a", metalness: 1, roughness: 0.62 },
  },
  chrome: {
    label: "Chrome",
    preset: "chrome",
    color: "#eceef1",
    metalness: 1,
    roughness: 0.04,
    engraving: { color: "#8c9097", metalness: 1, roughness: 0.45 },
  },
  gold: {
    label: "Gold",
    preset: "gold",
    color: "#e9bd63",
    metalness: 1,
    roughness: 0.18,
    engraving: { color: "#9c7834", metalness: 1, roughness: 0.55 },
  },
  "rose-gold": {
    label: "Rose gold",
    preset: "rose-gold",
    color: "#eab09a",
    metalness: 1,
    roughness: 0.2,
    engraving: { color: "#a06d5d", metalness: 1, roughness: 0.55 },
  },
  "matte-black": {
    label: "Matte black",
    preset: "matte",
    // Dark grey rather than black, so the card stays visible against a dark background.
    color: "#2b2d32",
    metalness: 0,
    roughness: 0.48,
    // Laser engraving cuts through the coating to the steel below.
    engraving: { color: "#b9bdc3", metalness: 1, roughness: 0.32 },
  },
  "glossy-paint": {
    label: "Glossy paint",
    preset: "paint",
    color: "#1d3f8f",
    metalness: 0,
    roughness: 0.45,
    engraving: { color: "#f2f4f7", metalness: 0, roughness: 0.4 },
  },
  glass: {
    label: "Glass",
    preset: "glass",
    color: "#f4f8fb",
    metalness: 0,
    roughness: 0.04,
    // Thicker than the card so the refraction is visible, with a faint blue-green tint.
    physical: { thickness: 0.4, attenuationColor: new THREE.Color("#cfe6ee"), attenuationDistance: 1.5 },
    engraving: { color: "#ffffff", metalness: 0, roughness: 0.55 },
  },
};

/**
 * Creates the face and edge materials for a finish.
 *
 * @param art Engraving mask for the front, where opaque pixels are engraved. It is oriented
 * like the card held upright. Without it the card is plain.
 */
export const createCardMaterials = (finish: CardFinish, art: THREE.Texture | null = null) => {
  const spec = CARD_FINISHES[finish];
  const { width, height } = CARD_SIZE;
  // UVs computed from the geometry position, 0 to 1 across the front with the top at 1.
  const cardUv = vec2(positionGeometry.x.div(width).add(0.5), positionGeometry.y.div(height).add(0.5));
  const make = (withArt: boolean) =>
    new PresetMaterial(spec.preset, {
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      uv: cardUv,
      physical: spec.physical,
      engrave: withArt && art ? { mask: art, ...spec.engraving, weight: step(0, normalGeometry.z) } : null,
    }).material;
  return { face: make(true), edge: make(false) };
};

const rgb = (value: THREE.ColorRepresentation) => {
  const c = new THREE.Color(value);
  return vec3(c.r, c.g, c.b);
};

// Chip position relative to the card centre.
const CHIP_AT = new THREE.Vector3(-CARD_SIZE.width / 2 + 0.62, 0.08, CARD_SIZE.thickness / 2 + 0.002);

/** Gold contact pads with grooves. */
const createChip = () => {
  const geometry = new RoundedBoxGeometry(0.44, 0.34, 0.006, 2, 0.04);
  // Glass refracts whatever was drawn before it, and three sorts transparent objects by the
  // centres of their bounding spheres. The chip is marked transparent, though fully opaque, and its
  // sphere is centred in front of the card centre. It is then drawn after the glass from the front
  // and before it from the back, at any angle. The sphere still encloses the whole chip for culling and taps.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(-CHIP_AT.x, -CHIP_AT.y, 0),
    Math.hypot(CHIP_AT.x, CHIP_AT.y) + Math.hypot(0.22, 0.17, 0.003),
  );
  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.25, transparent: true });
  // One vertical groove down the centre and three horizontal ones.
  const x = positionGeometry.x.div(0.44).add(0.5);
  const y = positionGeometry.y.div(0.34).add(0.5);
  const groove = smoothstep(0.012, 0.004, abs(x.sub(0.5)))
    .max(
      smoothstep(
        0.012,
        0.004,
        abs(fract(y.mul(3)).sub(0.5))
          .sub(0.48)
          .abs(),
      ),
    )
    .mul(step(0, normalGeometry.z));
  material.colorNode = mix(rgb("#e3be6b"), rgb("#8f6c2c"), groove) as unknown as ColorNode;
  const chip = new THREE.Mesh(geometry, material);
  chip.name = "Card:chip";
  return chip;
};

export interface CardOptions {
  finish?: CardFinish;
  /** Engraving mask for the front, where opaque pixels are engraved. For example from useTexture(). */
  art?: THREE.Texture | null;
  /** Gold chip on the front (default true). */
  chip?: boolean;
}

const createCardGeometry = () => {
  const { thickness } = CARD_SIZE;
  // The bevel grows the outline by its size, so the shape is drawn that much smaller.
  const bevel = thickness * 0.25;
  const width = CARD_SIZE.width - bevel * 2;
  const height = CARD_SIZE.height - bevel * 2;
  const radius = CARD_SIZE.radius - bevel;
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -(thickness - bevel * 2) / 2);
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * A payment card centred on the origin with its front facing +z. Material group 0 of the body
 * covers the front and back and uses the face material with the engraved art. Group 1 covers the
 * edge and uses the plain material. Change the finish with setCardFinish().
 */
export const createCard = ({ finish = "brushed-steel", art = null, chip = true }: CardOptions = {}) => {
  const card = new THREE.Group();
  card.name = "Card";
  const { face, edge } = createCardMaterials(finish, art);
  const body = new THREE.Mesh(createCardGeometry(), [face, edge]);
  body.name = "Card:body";
  card.add(body);
  if (chip) {
    const chipMesh = createChip();
    chipMesh.position.copy(CHIP_AT);
    card.add(chipMesh);
  }
  card.userData.finish = finish;
  return card;
};

/** Switches the finish of a card from createCard() in place and disposes the old materials. */
export const setCardFinish = (card: THREE.Object3D, finish: CardFinish, art: THREE.Texture | null = null) => {
  const body = card.getObjectByName("Card:body") as THREE.Mesh | undefined;
  if (!body) throw new Error("setCardFinish needs a card from createCard()");
  for (const material of body.material as THREE.Material[]) material.dispose();
  const { face, edge } = createCardMaterials(finish, art);
  body.material = [face, edge];
  card.userData.finish = finish;
};
