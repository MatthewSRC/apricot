import * as THREE from "three/webgpu";

// three's AgX tone mapping (nodes/display/ToneMappingFunctions.js) on the
// CPU. Matrices are column-major, as three writes them, so
// m * v = c0 * v.x + c1 * v.y + c2 * v.z.
type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
type Vec3 = [number, number, number];

const SRGB_TO_REC2020: Mat3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956];
const REC2020_TO_SRGB: Mat3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const INSET: Mat3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591,
  0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859,
];
const OUTSET: Mat3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272,
  -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

const mul = (m: Mat3, [x, y, z]: Vec3): Vec3 => [
  m[0] * x + m[3] * y + m[6] * z,
  m[1] * x + m[4] * y + m[7] * z,
  m[2] * x + m[5] * y + m[8] * z,
];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const contrast = (x: number) => {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};

/** AgX tone mapping of a linear colour, matching three's. */
export const agxToneMap = (color: Vec3, exposure = 1): Vec3 => {
  let c = mul(INSET, mul(SRGB_TO_REC2020, [color[0] * exposure, color[1] * exposure, color[2] * exposure]));
  c = c.map((v) => contrast(clamp01((Math.log2(Math.max(v, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV)))) as Vec3;
  c = mul(OUTSET, c).map((v) => Math.max(0, v) ** 2.2) as Vec3;
  return mul(REC2020_TO_SRGB, c).map(clamp01) as Vec3;
};

/**
 * The colour to put in the scene so that the screen shows `target` after
 * tone mapping, for example a background that matches the app's UI
 * exactly. three tone-maps the whole frame, background included, so
 * #ffffff would otherwise show as light grey. Only AgX is inverted; for
 * other tone mappings the colour is returned unchanged.
 */
export const untoneMapped = (
  target: THREE.Color,
  toneMapping: THREE.ToneMapping,
  exposure = 1,
  out = new THREE.Color(),
) => {
  out.copy(target);
  if (toneMapping !== THREE.AgXToneMapping) return out;
  const goal: Vec3 = [target.r, target.g, target.b];
  const c: Vec3 = [...goal];
  // Scales each channel by its error. AgX is monotonic and nearly
  // per-channel, so this converges in a few dozen steps. AgX peaks at about
  // 0.997, so white needs a very bright input, which is capped at 4096.
  for (let step = 0; step < 48; step++) {
    const shown = agxToneMap(c, exposure);
    for (let i = 0; i < 3; i++) {
      if (shown[i] > 1e-5) c[i] = Math.min(4096, Math.max(0, c[i] * (goal[i] / shown[i])));
      else if (goal[i] > 0) c[i] = Math.min(4096, c[i] * 2 + 1e-4);
    }
  }
  return out.setRGB(c[0], c[1], c[2]);
};
