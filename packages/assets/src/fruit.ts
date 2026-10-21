import { mergeColoredParts } from "@apricotjs/core";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { color as colorNode, dot, normalView, positionViewDirection, pow } from "three/tsl";
import * as THREE from "three/webgpu";

export interface AppleOptions {
  /** Diameter of the body (default 1). */
  size?: number;
  /** Skin colour (default emoji red). */
  color?: THREE.ColorRepresentation;
  /** Leaf on the stem (default true). */
  leaf?: boolean;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const ease = (from: number, to: number, t: number) => smoothstep(clamp01((t - from) / (to - from)));

// The apple outline from bottom to top, for a lathe. It is a unit circle widened towards the
// shoulders, with a deep dimple at the stem and a small one at the bottom.
const appleProfile = (steps = 28) => {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    let x = Math.sin(a) * (1 + 0.09 * ((1 - Math.cos(a)) / 2));
    let y = -Math.cos(a);
    y -= 0.3 * Math.exp(-(((Math.PI - a) / 0.42) ** 2));
    y += 0.1 * Math.exp(-((a / 0.35) ** 2));
    if (i === 0 || i === steps) x = 0;
    points.push(new THREE.Vector2(x * 0.5, y * 0.5));
  }
  return points;
};

/**
 * An emoji-style apple with a glossy red body, a brown stem and a leaf, merged into one
 * vertex-coloured geometry so it instances in one draw call. It is centred on the origin.
 * `userData.radius` is its collision radius for <Pile>.
 */
export const createApple = ({ size = 1, color = "#e8343a", leaf = true }: AppleOptions = {}) => {
  const skin = new THREE.Color(color);
  const shade = skin.clone().multiplyScalar(0.72);
  const shine = skin.clone().lerp(new THREE.Color("#ff8a6a"), 0.25);
  const profile = appleProfile();
  const bottom = profile[0].y;
  const top = profile[profile.length - 1].y;
  const height = Math.max(...profile.map((p) => p.y)) - bottom;

  const body = new THREE.LatheGeometry(profile, 40);
  const stemCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, top - 0.02, 0),
    new THREE.Vector3(0, top + 0.14, 0),
    new THREE.Vector3(0.07, top + 0.24, 0),
  );
  const stem = new THREE.TubeGeometry(stemCurve, 6, 0.028, 6, false);
  const parts: Parameters<typeof mergeColoredParts>[0][number][] = [
    {
      geometry: body,
      // Darker underneath, a warm sheen towards the top.
      color: (p) => {
        const t = smoothstep(clamp01((p.y - bottom) / height));
        return t < 0.5 ? shade.clone().lerp(skin, t * 2) : skin.clone().lerp(shine, (t - 0.5) * 2);
      },
    },
    { geometry: stem, color: "#6b3f22" },
  ];
  if (leaf) {
    const blade = new THREE.SphereGeometry(1, 14, 8);
    const placement = new THREE.Matrix4().compose(
      new THREE.Vector3(0.16, top + 0.17, 0.02),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.3, 0.45)),
      new THREE.Vector3(0.17, 0.022, 0.085),
    );
    parts.push({
      geometry: blade,
      matrix: placement,
      // Lighter towards the tip.
      color: (p) => new THREE.Color("#2f9e44").lerp(new THREE.Color("#69c46d"), clamp01((p.x - 0.02) / 0.3)),
    });
  }
  const geometry = mergeColoredParts(parts);
  for (const part of parts) part.geometry.dispose();
  if (size !== 1) geometry.scale(size, size, size);

  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 });
  const apple = new THREE.Mesh(geometry, material);
  apple.name = "Apple";
  apple.userData.radius = 0.5 * size;
  return apple;
};

export interface PeachOptions {
  /** Width of the body (default 1). */
  size?: number;
  /** Leaves at the stem (default true). */
  leaves?: boolean;
  /** Mesh smoothness from 0 to 1 (default 1). Use lower values for many small or blurred copies. */
  detail?: number;
}

/** Signed distance of a unit-sphere point from the crease, which bows out to the right like the emoji. */
const creaseOffset = (x: number, y: number, z: number) => x - 0.2 * (1 - y * y) * Math.max(0, z);

/**
 * Moves a point of the unit sphere towards the crease line so vertices bunch up there.
 * The crease is much narrower than the vertex spacing and would look jagged otherwise.
 */
const gatherToCrease = (direction: THREE.Vector3) => {
  const { x, y, z } = direction;
  const width = 0.06;
  const weight = 0.85 * ease(-0.3, 0.3, z) * (1 - ease(0.75, 0.98, Math.abs(y)));
  direction.x -= weight * width * Math.tanh(creaseOffset(x, y, z) / width);
  return direction.normalize();
};

/**
 * Shapes the peach skin from a unit sphere. A crease down the front splits it into two lobes, starting
 * below the stem and fading before the bottom. The top is a broad dome with a small dimple at the stem.
 * Writes the shaped point to `out` and returns how deep in the crease it lies, from 0 to 1.
 */
const shapePeach = (direction: THREE.Vector3, out: THREE.Vector3) => {
  const { x, y, z } = direction;
  const offset = creaseOffset(x, y, z);
  const front = ease(-0.2, 0.5, z) * (1 - ease(0.85, 1, y)) * (1 - 0.8 * ease(0.45, 0.95, -y));
  const crease = Math.exp(-((offset / 0.0165) ** 2)) * front;
  const lobes = Math.exp(-(((Math.abs(offset) - 0.1) / 0.16) ** 2)) * front;
  const radius = 1 - 0.08 * crease + 0.05 * lobes;
  // Narrower towards the bottom with a slightly flattened top.
  const taper = 1 - 0.12 * Math.max(0, -y) ** 1.6;
  const dome = y > 0 ? 0.96 - 0.05 * y * y : 0.96;
  out.set(x * taper, y * dome, z * taper).multiplyScalar(radius);
  // The top gets a dimple at the stem and a dip where the crease meets it. The bottom gets a soft point.
  if (y > 0)
    out.y -=
      (0.045 * Math.exp(-(x * x + z * z) / 0.012) +
        0.13 * Math.exp(-((x / 0.17) ** 2)) * ease(-0.8, 0.1, z)) *
      y ** 2;
  else out.y -= 0.06 * Math.exp(-(x * x + z * z) / 0.05) * -y;
  return crease;
};

/**
 * A leaf blade along +x, tapered, folded along its midrib and curling down. Its vertex colours go
 * from dark green at the stem to light green at the tip and edge, with a pale midrib.
 */
const leafGeometry = () => {
  const g = new THREE.PlaneGeometry(1, 1, 16, 8);
  const p = g.getAttribute("position");
  const colors = new Float32Array(p.count * 3);
  const dark = new THREE.Color("#163c00");
  const bright = new THREE.Color("#4a8806");
  const rib = new THREE.Color("#98c626");
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5; // 0 at the stem, 1 at the tip
    const v = p.getY(i) * 2; // -1 … 1 across
    const width = 0.5 * Math.sin(Math.PI * u ** 0.75) ** 0.75;
    p.setXYZ(i, u, 0.16 * Math.abs(v) * width - 0.1 * u * u, v * width * 0.5);
    c.copy(dark).lerp(bright, clamp01(0.25 + 0.55 * u + 0.35 * Math.abs(v) - 0.25 * (v > 0 ? 1 : 0)));
    c.lerp(rib, 0.8 * Math.exp(-((v / 0.14) ** 2)) * ease(0.02, 0.2, u) * (1 - ease(0.8, 1, u)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
};

/**
 * An emoji-style peach, Apricot's mascot, with a two-lobed body, a short stem and two glossy leaves.
 * It has two meshes, the skin and the stem with leaves, so it instances in two draw calls.
 * It is centred on the origin. `userData.radius` is its collision radius.
 */
export const createPeach = ({ size = 1, leaves = true, detail = 1 }: PeachOptions = {}) => {
  // The sphere is welded at its seam so normals stay smooth there.
  const level = Math.min(1, Math.max(0, detail));
  const sphere = new THREE.SphereGeometry(1, Math.round(24 + 88 * level), Math.round(18 + 66 * level));
  sphere.deleteAttribute("uv");
  sphere.deleteAttribute("normal");
  const body = mergeVertices(sphere);
  sphere.dispose();
  const position = body.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const direction = new THREE.Vector3();
  const shaped = new THREE.Vector3();
  // Fully saturated because AgX tone mapping softens them, for example #ff8100 shows as #e4965a.
  const upper = new THREE.Color("#ff9200");
  const middle = new THREE.Color("#ff6400");
  const blush = new THREE.Color("#ff1406");
  const fold = new THREE.Color("#d01404");
  const color = new THREE.Color();
  let top = -1;
  for (let i = 0; i < position.count; i++) {
    gatherToCrease(direction.fromBufferAttribute(position, i).normalize());
    const crease = shapePeach(direction, shaped);
    shaped.multiplyScalar(0.5);
    position.setXYZ(i, shaped.x, shaped.y, shaped.z);
    if (Math.abs(direction.x) < 0.05 && Math.abs(direction.z) < 0.05 && direction.y > 0)
      top = Math.max(top, shaped.y);
    const { x, y, z } = direction;
    const height = (y + 1) / 2;
    color
      .copy(blush)
      .lerp(middle, ease(0, 0.4, height))
      .lerp(upper, ease(0.45, 0.9, height));
    // The left lobe turns red down its outer side while the right stays orange.
    color.lerp(blush, 0.85 * ease(0.2, 1, -0.75 * x - 0.5 * y + 0.1 * z));
    color.lerp(fold, 0.7 * crease);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  body.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  body.computeVertexNormals();
  if (top < 0) top = 0.38;

  const skin = new THREE.Mesh(
    body,
    new THREE.MeshPhysicalNodeMaterial({
      vertexColors: true,
      roughness: 0.5,
      // A warm sheen at grazing angles imitates fuzz. A white sheen would wash out the colour.
      sheen: 0.2,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color("#ff9a60"),
      clearcoat: 0.15,
      clearcoatRoughness: 0.4,
    }),
  );
  skin.name = "Peach skin";
  // A light-independent glow towards the silhouette.
  const facing = dot(normalView, positionViewDirection).clamp(0, 1);
  (skin.material as THREE.MeshPhysicalNodeMaterial).emissiveNode = colorNode("#ffb89a").mul(
    pow(facing.oneMinus(), 5).mul(0.8),
  );

  // The stem rises from the dimple and leans a little to the left.
  const stemCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, top - 0.03, 0),
    new THREE.Vector3(0.012, top + 0.08, 0),
    new THREE.Vector3(-0.035, top + 0.17, 0.005),
  );
  const stemTip = stemCurve.getPoint(1);
  const bark = (p: THREE.Vector3) =>
    new THREE.Color("#4e2810").lerp(new THREE.Color("#a0704a"), clamp01((p.y - top) / 0.17));
  const parts: Parameters<typeof mergeColoredParts>[0][number][] = [
    { geometry: new THREE.TubeGeometry(stemCurve, 8, 0.028, 8, false), color: bark },
    {
      geometry: new THREE.SphereGeometry(0.028, 8, 6),
      matrix: new THREE.Matrix4().makeTranslation(stemTip.x, stemTip.y, stemTip.z),
      color: "#a0704a",
    },
  ];
  if (leaves) {
    const blade = leafGeometry();
    for (const side of [-1, 1]) {
      const placement = new THREE.Matrix4().compose(
        new THREE.Vector3(side * 0.025, top + 0.05, -0.05),
        // The tip is raised about z, then turned about y, then tilted towards the viewer about x.
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, side < 0 ? Math.PI - 0.2 : 0.2, 0.4)),
        new THREE.Vector3(side < 0 ? 0.56 : 0.5, 0.5, side < 0 ? 0.5 : 0.46),
      );
      parts.push({ geometry: blade, matrix: placement, color: "vertex" });
    }
  }
  const stemAndLeaves = new THREE.Mesh(
    mergeColoredParts(parts),
    new THREE.MeshStandardNodeMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  for (const part of parts) part.geometry.dispose();
  stemAndLeaves.name = "Peach leaves";

  const peach = new THREE.Group();
  peach.name = "Peach";
  peach.add(skin, stemAndLeaves);
  if (size !== 1) peach.scale.setScalar(size);
  peach.userData.radius = 0.5 * size;
  return peach;
};
