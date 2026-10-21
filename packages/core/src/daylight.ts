import * as THREE from "three/webgpu";

/** The lighting at one time of day. */
export interface DaylightKey {
  /** Hour of the day, 0 to 24. */
  hour: number;
  /** Colour of the sun, or the moon at night. */
  sun: THREE.ColorRepresentation;
  /** Intensity of the sun or moon light. */
  sunIntensity: number;
  /** Hemisphere fill colour from the sky above. */
  sky: THREE.ColorRepresentation;
  /** Hemisphere fill colour bounced from the ground below. */
  ground: THREE.ColorRepresentation;
  /** Intensity of the hemisphere fill. */
  fillIntensity: number;
  /** Background and haze colour. */
  background: THREE.ColorRepresentation;
  /** Environment reflection intensity. */
  reflections: number;
}

/** Keys for a full day from night through dawn, noon and dusk. Pass different keys for another mood. */
export const DAY: readonly DaylightKey[] = [
  {
    hour: 0,
    sun: "#8fa6d9",
    sunIntensity: 0.25,
    sky: "#26304f",
    ground: "#0b0d14",
    fillIntensity: 0.5,
    background: "#0d1326",
    reflections: 0.25,
  },
  {
    hour: 5.5,
    sun: "#9fb0d9",
    sunIntensity: 0.3,
    sky: "#3a4366",
    ground: "#111420",
    fillIntensity: 0.6,
    background: "#2a3150",
    reflections: 0.35,
  },
  {
    hour: 6.5,
    sun: "#ffb27a",
    sunIntensity: 1.3,
    sky: "#ffd2ad",
    ground: "#5e5248",
    fillIntensity: 0.9,
    background: "#f2c6a2",
    reflections: 0.7,
  },
  {
    hour: 9,
    sun: "#fff0d8",
    sunIntensity: 2.4,
    sky: "#dcecff",
    ground: "#8a7a6a",
    fillIntensity: 1.1,
    background: "#cfe2f2",
    reflections: 1,
  },
  {
    hour: 13,
    sun: "#ffffff",
    sunIntensity: 2.8,
    sky: "#e3f0ff",
    ground: "#8f8272",
    fillIntensity: 1.2,
    background: "#c4ddf2",
    reflections: 1,
  },
  {
    hour: 17,
    sun: "#ffe0b0",
    sunIntensity: 2.2,
    sky: "#f3e6d8",
    ground: "#85735f",
    fillIntensity: 1.05,
    background: "#dde2e8",
    reflections: 0.95,
  },
  {
    hour: 18.8,
    sun: "#ff9459",
    sunIntensity: 1.1,
    sky: "#f6b48c",
    ground: "#4f4038",
    fillIntensity: 0.8,
    background: "#eeac85",
    reflections: 0.65,
  },
  {
    hour: 20,
    sun: "#8fa6d9",
    sunIntensity: 0.3,
    sky: "#33395a",
    ground: "#0e1018",
    fillIntensity: 0.55,
    background: "#1a2038",
    reflections: 0.3,
  },
];

/**
 * DAY with brighter nights: a strong moon and a deep blue sky, for outdoor
 * scenes without lamps. DAY's nights are nearly black, which suits rooms
 * with their own lights.
 */
export const MOONLIT: readonly DaylightKey[] = DAY.map((key) =>
  key.hour <= 5.5 || key.hour >= 20
    ? {
        ...key,
        sun: "#b4c6f0",
        sunIntensity: key.hour === 5.5 ? 0.75 : 0.7,
        sky: "#5a6c9e",
        ground: "#262c40",
        fillIntensity: 1,
        background: key.hour === 5.5 ? "#33406a" : "#1d2849",
        reflections: 0.45,
      }
    : key,
);

export interface DaylightState {
  /** Unit vector from the scene towards the sun, or the moon at night. */
  sunDirection: THREE.Vector3;
  /**
   * Fraction of direct sun or moon light, 0 to 1. It dips to 0 around
   * sunrise and sunset, where the light switches between sun and moon, so
   * shadows do not jump. It is 1 the rest of the time.
   */
  direct: number;
  /**
   * Darkness from 0 (day) to 1 (night), independent of the key colours. It
   * rises over the hour before sunset and falls over the hour after
   * sunrise. Useful for switching lamps on at dusk.
   */
  dark: number;
  sun: THREE.Color;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  fillIntensity: number;
  background: THREE.Color;
  reflections: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sunrise and sunset hours. Match them to the keys; DAY uses 6 and 19. */
export interface SunTimes {
  sunrise?: number;
  sunset?: number;
}

// Hours either side of sunrise and sunset over which the direct light fades out and back.
const HORIZON_FADE = 0.4;

/**
 * The lighting at `hour` (wrapped to 0 to 24), with colours interpolated
 * between `keys`. The sun rises in the east (+x) at `sunrise` (default 6),
 * is highest midway, towards the south (-z), and sets in the west at
 * `sunset` (default 19). At night the moon follows the same path.
 * `northOffset` rotates the compass, in radians.
 */
export const daylightAt = (
  hour: number,
  keys: readonly DaylightKey[] = DAY,
  northOffset = 0,
  { sunrise = 6, sunset = 19 }: SunTimes = {},
): DaylightState => {
  const h = ((hour % 24) + 24) % 24;
  const sorted = [...keys].sort((a, b) => a.hour - b.hour);
  let i = sorted.findIndex((k) => k.hour > h);
  if (i === -1) i = sorted.length;
  const a = sorted[(i - 1 + sorted.length) % sorted.length];
  const b = sorted[i % sorted.length];
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = ((h - a.hour + 24) % 24) / span;
  const color = (x: THREE.ColorRepresentation, y: THREE.ColorRepresentation) =>
    new THREE.Color(x).lerp(new THREE.Color(y), t);

  // The sun crosses from east to west by day and the moon does the same by night.
  const dayLength = (sunset - sunrise + 24) % 24 || 24;
  const sinceRise = (h - sunrise + 24) % 24;
  const day = sinceRise < dayLength;
  const progress = day ? sinceRise / dayLength : (sinceRise - dayLength) / (24 - dayLength);
  const arc = progress * Math.PI;
  const height = Math.max(0.12, Math.sin(arc)) * (day ? 1 : 0.7);
  const direction = new THREE.Vector3(Math.cos(arc), height, -0.45).normalize();
  direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), northOffset);
  // The light switches between sun and moon at sunrise and sunset, so fade it out and back in around then.
  const fromSwap = Math.min(sinceRise, Math.abs(sinceRise - dayLength), 24 - sinceRise);
  const x = Math.min(1, fromSwap / HORIZON_FADE);
  const direct = x * x * (3 - 2 * x);
  // Darken over the hour before sunset and lighten over the hour after sunrise.
  const fromEdge = day ? Math.min(sinceRise, dayLength - sinceRise) : 0;
  const light = Math.min(1, fromEdge);
  const dark = day ? 1 - light * light * (3 - 2 * light) : 1;

  return {
    sunDirection: direction,
    direct,
    dark,
    sun: color(a.sun, b.sun),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t) * direct,
    sky: color(a.sky, b.sky),
    ground: color(a.ground, b.ground),
    fillIntensity: lerp(a.fillIntensity, b.fillIntensity, t),
    background: color(a.background, b.background),
    reflections: lerp(a.reflections, b.reflections, t),
  };
};
