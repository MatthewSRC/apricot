import { mergeColoredParts, seededRandom } from "@apricotjs/core";
import { color, float, length, mix, positionWorld, smoothstep, step, uv } from "three/tsl";
import * as THREE from "three/webgpu";

type ColorNode = THREE.Node<"vec4">;

const at = (x: number, y: number, z: number, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));

const shaded = (base: THREE.ColorRepresentation, low: number, high: number) => (p: THREE.Vector3) =>
  new THREE.Color(base).multiplyScalar(0.78 + 0.32 * Math.min(1, Math.max(0, (p.y - low) / (high - low))));

/** A round cartoon tree about 2.4 tall with its base at y = 0. */
export const createRoundTreeGeometry = () => {
  const trunk = new THREE.CylinderGeometry(0.12, 0.17, 0.9, 8);
  const crown = new THREE.IcosahedronGeometry(0.75, 2);
  const side = new THREE.IcosahedronGeometry(0.5, 1);
  const geometry = mergeColoredParts([
    { geometry: trunk, color: "#8a5a3b", matrix: at(0, 0.45, 0) },
    { geometry: crown, color: shaded("#5cb85c", 0.9, 2.4), matrix: at(0, 1.55, 0) },
    { geometry: side, color: shaded("#5cb85c", 0.9, 2.4), matrix: at(0.45, 1.25, 0.15) },
    { geometry: side, color: shaded("#5cb85c", 0.9, 2.4), matrix: at(-0.38, 1.3, -0.2, 0.9) },
  ]);
  for (const g of [trunk, crown, side]) g.dispose();
  return geometry;
};

/** A pine tree about 2.8 tall with its base at y = 0. */
export const createPineTreeGeometry = () => {
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 0.6, 8);
  const tiers = [0, 1, 2].map((i) => new THREE.ConeGeometry(0.85 - i * 0.22, 1.1 - i * 0.15, 10));
  const geometry = mergeColoredParts([
    { geometry: trunk, color: "#7a4e33", matrix: at(0, 0.3, 0) },
    ...tiers.map((tier, i) => ({
      geometry: tier,
      color: shaded("#2f8f57", 0.5, 2.8),
      matrix: at(0, 1.05 + i * 0.6, 0),
    })),
  ]);
  trunk.dispose();
  for (const tier of tiers) tier.dispose();
  return geometry;
};

export interface TreesOptions {
  /** Number of trees (default 120). */
  count?: number;
  /** Area to scatter in as [minX, minZ, maxX, maxZ] (default [-80, -80, 80, 80]). */
  area?: readonly [number, number, number, number];
  /** Radius of a tree-free circle around the origin (default 8). */
  clearing?: number;
  /** Random size range (default [0.8, 1.4]). */
  scale?: readonly [number, number];
  /** Random seed (default 1). */
  seed?: number;
}

/** Scattered round and pine trees with one InstancedMesh per kind, so a forest takes two draw calls. */
export const createTrees = ({
  count = 120,
  area = [-80, -80, 80, 80],
  clearing = 8,
  scale = [0.8, 1.4],
  seed = 1,
}: TreesOptions = {}) => {
  const random = seededRandom(seed);
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
  const kinds = [createRoundTreeGeometry(), createPineTreeGeometry()].map((geometry, i) => {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.name = i === 0 ? "Trees:round" : "Trees:pine";
    mesh.count = 0;
    return mesh;
  });
  const group = new THREE.Group();
  group.name = "Trees";
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const [minX, minZ, maxX, maxZ] = area;
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    // Rejection sampling outside the clearing, limited to 20 attempts for small areas.
    for (let attempt = 0; attempt < 20; attempt++) {
      x = minX + random() * (maxX - minX);
      z = minZ + random() * (maxZ - minZ);
      if (Math.hypot(x, z) >= clearing) break;
    }
    const mesh = kinds[random() < 0.5 ? 0 : 1];
    const s = scale[0] + random() * (scale[1] - scale[0]);
    quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
    mesh.setMatrixAt(
      mesh.count++,
      matrix.compose(new THREE.Vector3(x, 0, z), quaternion, new THREE.Vector3(s, s, s)),
    );
  }
  for (const mesh of kinds) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
};

export interface GroundOptions {
  /** Width and depth (default 400). */
  size?: number;
  /** Side of one checker tile (default 4). */
  tile?: number;
  /** The two tile colours. */
  colors?: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation];
}

/** A flat ground at y = 0 with a two-tone checker drawn in a shader. The tiles are in world space. */
export const createGround = ({
  size = 400,
  tile = 4,
  colors = ["#a3d77f", "#97cf72"],
}: GroundOptions = {}) => {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const cell = positionWorld.xz.div(tile).floor();
  const checker = cell.x.add(cell.y).mod(2).abs();
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  material.colorNode = mix(
    color(new THREE.Color(colors[0])),
    color(new THREE.Color(colors[1])),
    step(float(0.5), checker),
  ) as unknown as ColorNode;
  const ground = new THREE.Mesh(geometry, material);
  ground.name = "Ground";
  return ground;
};

export interface ContactShadowOptions {
  /** Size along x (default 1). */
  width?: number;
  /** Size along z (default 1). */
  length?: number;
  /** Darkness at the centre, from 0 to 1 (default 0.35). */
  opacity?: number;
}

/**
 * A soft dark ellipse just above the ground, to place under an object.
 * It avoids the second render pass that real shadows need.
 */
export const createContactShadow = ({
  width = 1,
  length: depth = 1,
  opacity = 0.35,
}: ContactShadowOptions = {}) => {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = color(new THREE.Color("#000000")) as unknown as ColorNode;
  const falloff = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
  material.opacityNode = falloff.mul(falloff).mul(opacity);
  const shadow = new THREE.Mesh(geometry, material);
  shadow.name = "ContactShadow";
  shadow.position.y = 0.01;
  shadow.renderOrder = -1;
  return shadow;
};

export interface BackdropOptions {
  /** Width and height (default [30, 30]). */
  size?: readonly [number, number];
  /** Colours at the centre and at the edges. */
  colors?: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation];
  /** Faint diagonal lines that make refraction visible through transmissive materials (default true). */
  lines?: boolean;
}

/**
 * A photo-studio backdrop, an unlit plane facing +z with a soft vignette. Put it behind a product,
 * for example at z = -3. Glass and other transmissive materials need it, because refracting a flat
 * background colour shows no visible change.
 */
export const createBackdrop = ({
  size = [30, 30],
  colors = ["#262a31", "#0e0f12"],
  lines = true,
}: BackdropOptions = {}) => {
  const geometry = new THREE.PlaneGeometry(size[0], size[1]);
  const material = new THREE.MeshBasicNodeMaterial();
  const p = uv().sub(0.5);
  const vignette = smoothstep(0.05, 0.55, length(p));
  let tone: THREE.Node<"vec3"> = mix(
    color(new THREE.Color(colors[0])),
    color(new THREE.Color(colors[1])),
    vignette,
  );
  if (lines) {
    // The lines fade towards the edges.
    const stripe = positionWorld.x.add(positionWorld.y).mul(2).fract();
    const line = smoothstep(0.04, 0, stripe.sub(0.5).abs().sub(0.46).abs());
    tone = tone.add(line.mul(float(1).sub(vignette)).mul(0.03));
  }
  material.colorNode = tone as unknown as ColorNode;
  const backdrop = new THREE.Mesh(geometry, material);
  backdrop.name = "Backdrop";
  return backdrop;
};
