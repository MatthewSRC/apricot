import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { color, length, mix, smoothstep, uv } from "three/tsl";
import * as THREE from "three/webgpu";

type ColorNode = THREE.Node<"vec4">;

// Showroom models with separate named parts and named materials, like a model from an artist.
// The sedan uses Italian names so that model kits can show how they map any naming to app names.

const material = (name: string, hex: THREE.ColorRepresentation, roughness = 0.5, metalness = 0) =>
  new THREE.MeshStandardNodeMaterial({ name, color: hex, roughness, metalness });

const box = (
  name: string,
  mat: THREE.Material,
  [w, h, d]: readonly [number, number, number],
  [x, y, z]: readonly [number, number, number],
  radius = 0.02,
) => {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
};

const group = (name: string, ...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  g.name = name;
  g.add(...children);
  return g;
};

/** Sedan dimensions in metres. */
export const SEDAN_DIMENSIONS = { length: 4.5, width: 1.8, height: 1.47, wheelRadius: 0.34 } as const;

/**
 * A stylised sedan facing +z with its wheels on the ground.
 *
 * Parts: carrozzeria (body), cofano (hood), bagagliaio (trunk), tetto (roof), abitacolo (cabin glass),
 * interni (seats), porta_ant_sx, porta_ant_dx, porta_post_sx and porta_post_dx (doors with their windows,
 * where sx is left at +x), ruota_* (wheels), fari (headlights), fanali (tail lights) and griglia (grille).
 *
 * Materials: vernice (paint), vetro (glass), gomma (rubber), cerchio (rim), luce (light),
 * luce_posteriore (tail light), plastica_nera (black plastic) and interni (interior).
 */
export const createSedan = () => {
  const paint = material("vernice", "#b8bcc4", 0.4, 0.3);
  const glass = material("vetro", "#20262c", 0.1);
  const rubber = material("gomma", "#1c1d1f", 0.9);
  const rim = material("cerchio", "#c8ccd2", 0.25, 1);
  const light = material("luce", "#f4f6fa", 0.2);
  const tail = material("luce_posteriore", "#b3121b", 0.3);
  const black = material("plastica_nera", "#141518", 0.5);
  const inside = material("interni", "#2b2d32", 0.8);
  const { length: L, width: W, wheelRadius: R } = SEDAN_DIMENSIONS;
  const top = 0.87;

  const body = box("carrozzeria", paint, [W, 0.62, L], [0, 0.56, 0], 0.18);
  const hood = box("cofano", paint, [1.62, 0.05, 1.25], [0, top + 0.02, L / 2 - 0.78]);
  const trunk = box("bagagliaio", paint, [1.5, 0.05, 0.8], [0, top + 0.02, -L / 2 + 0.55]);
  const cabin = box("abitacolo", glass, [1.5, 0.55, 2.3], [0, top + 0.27, -0.15], 0.2);
  const roof = box("tetto", paint, [1.42, 0.07, 1.6], [0, top + 0.56, -0.2], 0.03);
  const seats = box("interni", inside, [1.3, 0.4, 2], [0, top + 0.1, -0.15], 0.1);

  // Each door is a painted panel and its window. Left (sx) is +x.
  const door = (name: string, side: 1 | -1, z: number, depth: number) =>
    group(
      name,
      box(`${name}_pannello`, paint, [0.06, 0.52, depth], [side * 0.91, 0.6, z], 0.02),
      box(`${name}_vetro`, glass, [0.04, 0.4, depth - 0.12], [side * 0.77, top + 0.25, z], 0.02),
    );
  const doors = [
    door("porta_ant_sx", 1, 0.3, 1.05),
    door("porta_ant_dx", -1, 0.3, 1.05),
    door("porta_post_sx", 1, -0.8, 0.9),
    door("porta_post_dx", -1, -0.8, 0.9),
  ];

  // Each wheel is a tyre and a rim with the axle along x.
  const wheel = (name: string, x: number, z: number) => {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.24, 28), rubber);
    tyre.name = `${name}_gomma`;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.27, 24), rim);
    disc.name = `${name}_cerchio`;
    for (const m of [tyre, disc]) m.rotation.z = Math.PI / 2;
    const w = group(name, tyre, disc);
    w.position.set(x, R, z);
    return w;
  };
  const wheels = [
    wheel("ruota_ant_sx", 0.78, 1.35),
    wheel("ruota_ant_dx", -0.78, 1.35),
    wheel("ruota_post_sx", 0.78, -1.35),
    wheel("ruota_post_dx", -0.78, -1.35),
  ];

  const lamps = group(
    "fari",
    box("faro_sx", light, [0.42, 0.1, 0.06], [0.55, 0.74, L / 2 - 0.01]),
    box("faro_dx", light, [0.42, 0.1, 0.06], [-0.55, 0.74, L / 2 - 0.01]),
  );
  const tails = group(
    "fanali",
    box("fanale_sx", tail, [0.45, 0.1, 0.06], [0.55, 0.76, -L / 2 + 0.01]),
    box("fanale_dx", tail, [0.45, 0.1, 0.06], [-0.55, 0.76, -L / 2 + 0.01]),
  );
  const grille = box("griglia", black, [0.8, 0.16, 0.06], [0, 0.5, L / 2 + 0.01]);

  return group("Berlina", body, hood, trunk, cabin, roof, seats, ...doors, ...wheels, lamps, tails, grille);
};

/** Laptop dimensions: the base width, depth and thickness, and the lid thickness. */
export const LAPTOP_DIMENSIONS = { width: 3, depth: 2.1, base: 0.12, lid: 0.08 } as const;

/**
 * A closed laptop facing +z. The lid origin is at its hinge, so animations rotate it there.
 *
 * Parts: base, keyboard, trackpad and lid (lid_shell and lid_screen).
 * Materials: aluminium, keys and screen.
 */
export const createLaptop = () => {
  const { width: W, depth: D, base: B, lid: T } = LAPTOP_DIMENSIONS;
  const metal = material("aluminium", "#c9ccd1", 0.3, 1);
  const keys = material("keys", "#17181b", 0.6);
  const screen = material("screen", "#0d1730", 0.15);
  screen.emissive = new THREE.Color("#2a5bd7");
  screen.emissiveIntensity = 0.6;
  const base = box("base", metal, [W, B, D], [0, B / 2, 0], 0.05);
  const keyboard = box("keyboard", keys, [W - 0.4, 0.012, 1], [0, B, -0.3], 0.005);
  const trackpad = box("trackpad", keys, [1, 0.006, 0.6], [0, B, 0.6], 0.005);
  // The lid group sits on the hinge and its parts extend forward from it in the closed position.
  const shell = box("lid_shell", metal, [W, T, D], [0, T / 2 + 0.003, D / 2], 0.05);
  const panel = box("lid_screen", screen, [W - 0.3, 0.006, D - 0.3], [0, 0.004, D / 2], 0.003);
  const lid = group("lid", shell, panel);
  lid.position.set(0, B, -D / 2);
  return group("Laptop", base, keyboard, trackpad, lid);
};

/** A "LidOpen" animation clip for createLaptop() that opens the lid to 110° over one second. */
export const createLaptopAnimation = () => {
  const open = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-110 * Math.PI) / 180);
  return new THREE.AnimationClip("LidOpen", 1, [
    new THREE.QuaternionKeyframeTrack("lid.quaternion", [0, 1], [0, 0, 0, 1, ...open.toArray()]),
  ]);
};

export interface StudioFloorOptions {
  /** Radius (default 8). */
  radius?: number;
  /** Colours at the centre and at the edge. Match the edge colour to the scene background. */
  colors?: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation];
}

/** A round, unlit studio floor at y = 0 that fades into the background at its edge. */
export const createStudioFloor = ({
  radius = 8,
  colors = ["#30343b", "#0e0f12"],
}: StudioFloorOptions = {}) => {
  const geometry = new THREE.CircleGeometry(radius, 48);
  geometry.rotateX(-Math.PI / 2);
  const floor = new THREE.MeshBasicNodeMaterial();
  floor.colorNode = mix(
    color(new THREE.Color(colors[0])),
    color(new THREE.Color(colors[1])),
    smoothstep(0.05, 0.5, length(uv().sub(0.5))),
  ) as unknown as ColorNode;
  const mesh = new THREE.Mesh(geometry, floor);
  mesh.name = "StudioFloor";
  return mesh;
};
