import type { BurstOptions, EmitOptions } from "./options";

/** Preset bursts. Spread one into burst's options and override what you need. */
export const BURSTS = {
  /** Gold glints that rise a little and fade. */
  sparkle: {
    count: 24,
    colors: ["#fff3b0", "#ffd36b", "#ffffff"],
    speed: [0.2, 0.8],
    spread: 70,
    life: [0.5, 1.1],
    size: [0.06, 0.12],
    gravity: -0.4,
    drag: 1.5,
  },
  /** A firework shell: sparks in every direction that slow and fall. */
  firework: {
    count: 120,
    colors: ["#ff5a7a", "#ffd166", "#5ad1ff", "#b388ff", "#ffffff"],
    speed: [3, 4.5],
    spread: 180,
    life: [1, 1.6],
    size: [0.08, 0.14],
    gravity: 2.5,
    drag: 2.2,
  },
  /** A small, quick pop. */
  pop: {
    count: 16,
    colors: ["#ffffff", "#ffe08a"],
    speed: [0.8, 1.6],
    spread: 180,
    life: [0.25, 0.5],
    size: [0.05, 0.1],
    gravity: 1,
    drag: 3,
  },
  /** Paper confetti thrown up that flutters down. */
  confetti: {
    count: 80,
    colors: ["#ff5a7a", "#ffd166", "#3ccf6e", "#5ad1ff", "#b388ff"],
    speed: [2.5, 4],
    spread: 35,
    life: [2, 3],
    size: [0.05, 0.08],
    spin: [-540, 540],
    shape: "square",
    gravity: 1.2,
    drag: 2.5,
  },
} satisfies Record<string, BurstOptions>;

/** Preset streams. Spread one into emit's options and override what you need. */
export const EMITTERS = {
  /** Soft grey smoke that rises, spreads and drifts. */
  smoke: {
    rate: 12,
    area: [0.1, 0, 0.1],
    colors: ["#b9b4ae", "#cfcac4"],
    fadeTo: "#8f8a85",
    speed: [0.1, 0.3],
    spread: 25,
    life: [2.5, 3.5],
    size: [0.15, 0.25],
    grow: 3,
    spin: [-30, 30],
    gravity: -0.25,
    wind: [0.15, 0, 0],
    drag: 0.8,
  },
  /** Water thrown up that falls back, like a fountain. */
  fountain: {
    rate: 120,
    colors: ["#d8f1ff", "#a9dcff", "#ffffff"],
    speed: [2.6, 3.2],
    spread: 8,
    life: [0.9, 1.1],
    size: [0.05, 0.08],
    gravity: 6,
  },
  /** Snow falling slowly over an area. Set `area` and an `at` above the ground. */
  snow: {
    rate: 40,
    area: [6, 0, 6],
    colors: ["#ffffff", "#f1f6ff"],
    speed: [0.05, 0.15],
    direction: [0, -1, 0],
    spread: 30,
    life: [6, 8],
    size: [0.03, 0.06],
    gravity: 0.15,
    wind: [0.08, 0, 0.03],
    drag: 1,
  },
  /** Sparkler glints thrown out in every direction. Place `at` at the sparkler's tip. */
  sparkler: {
    rate: 90,
    colors: ["#fff3b0", "#ffd36b", "#ffffff"],
    fadeTo: "#ff8a3d",
    speed: [0.6, 1.4],
    spread: 180,
    life: [0.25, 0.5],
    size: [0.04, 0.07],
    grow: 0.3,
    gravity: 2,
    drag: 2,
  },
} satisfies Record<string, EmitOptions>;
