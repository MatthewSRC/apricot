import * as THREE from "three/webgpu";

/**
 * Lighting presets that look good with no setup.
 * - soft: pastel background, warm key light, cool fill (toy / emoji look)
 * - studio: neutral background, key + rim light (product viewer)
 * - flat: even light from everywhere, no shading contrast (cartoon / UI)
 *
 * They use plain lights, because generating an environment map (PMREM) on
 * the device is too slow for a scene's first frame.
 */
export type Look = "soft" | "studio" | "flat";

export interface LookSpec {
  background: THREE.ColorRepresentation;
  toneMapping: THREE.ToneMapping;
  /** Creates the look's lights. With `shadows`, light moves from the sky to the key light so shadows show. */
  lights: (shadows?: boolean) => THREE.Light[];
}

/**
 * Moves part of the sky light into the key light. Sky light (hemisphere,
 * ambient) reaches into shadows, so with a soft look shadows barely show.
 * After the move, lit areas keep about the same brightness and shadows get
 * darker. `lean` (0–1) scales how much moves, for example less while the
 * sun is near the horizon. Returns the new intensities.
 */
export const shadowBalance = (key: number, sky: number, lean = 1) => ({
  key: key + sky * 0.45 * lean,
  sky: sky * (1 - 0.45 * lean),
});

const directional = (
  color: THREE.ColorRepresentation,
  intensity: number,
  x: number,
  y: number,
  z: number,
) => {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(x, y, z);
  return light;
};

export const LOOKS: Record<Look, LookSpec> = {
  soft: {
    background: "#f6efe6",
    toneMapping: THREE.AgXToneMapping,
    lights: (shadows) => {
      const { key, sky } = shadows ? shadowBalance(2.4, 2.2) : { key: 2.4, sky: 2.2 };
      return [
        new THREE.HemisphereLight("#fff6ea", "#c9b6a2", sky),
        directional("#fff1dc", key, 3, 6, 4),
        directional("#dfe9ff", 0.6, -4, 2, -3),
      ];
    },
  },
  studio: {
    background: "#eceff3",
    toneMapping: THREE.AgXToneMapping,
    lights: (shadows) => {
      const { key, sky } = shadows ? shadowBalance(2.6, 1.6) : { key: 2.6, sky: 1.6 };
      return [
        new THREE.HemisphereLight("#ffffff", "#9aa3ad", sky),
        directional("#ffffff", key, 4, 5, 3),
        directional("#ffffff", 1.2, -3, 3, -4),
      ];
    },
  },
  flat: {
    background: "#ffffff",
    toneMapping: THREE.NoToneMapping,
    lights: () => [new THREE.AmbientLight("#ffffff", 3)],
  },
};

const LOOK_GROUP = "apricot:look";

/**
 * Adds a look's lights to `scene` in one named group, replacing those of a
 * previous look, and sets the background unless `background` is false.
 * Returns a function that removes the lights.
 */
export const applyLook = (
  scene: THREE.Scene,
  look: Look,
  options: { background?: boolean; shadows?: boolean } = {},
) => {
  const previous = scene.getObjectByName(LOOK_GROUP);
  if (previous) scene.remove(previous);
  const spec = LOOKS[look];
  const group = new THREE.Group();
  group.name = LOOK_GROUP;
  for (const light of spec.lights(options.shadows)) group.add(light);
  scene.add(group);
  if (options.background !== false) scene.background = new THREE.Color(spec.background);
  return () => {
    scene.remove(group);
    for (const child of group.children) (child as THREE.Light).dispose();
  };
};
