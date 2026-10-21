import type * as THREE from "three/webgpu";
import type { Vec3 } from "../spin";

/** A fixed value, or a range [min, max] from which each particle picks a random value. */
export type Spread = number | readonly [number, number];

/** The look and motion of a burst of particles. See Particles.burst. */
export interface BurstOptions {
  /** Starting point in the particles' local space (default [0, 0, 0]). */
  at?: Vec3;
  /** Size in metres of a box around `at` in which particles start at random points (default: all start at `at`). */
  area?: Vec3;
  /** Number of particles (default 40). */
  count?: number;
  /** Colours to pick from, one per particle (default white). */
  colors?: readonly THREE.ColorRepresentation[];
  /** A colour each particle changes to over its life. */
  fadeTo?: THREE.ColorRepresentation;
  /** Launch speed in metres per second (default [1, 2]). */
  speed?: Spread;
  /** Launch direction (default up, [0, 1, 0]). */
  direction?: Vec3;
  /** Largest angle from `direction` in degrees (default 180, every direction). */
  spread?: number;
  /** Lifetime in seconds (default [0.6, 1.2]). */
  life?: Spread;
  /** Size in metres (default 0.05). */
  size?: Spread;
  /** Size at the end of life as a multiple of the starting size (default 1). */
  grow?: number;
  /** Rotation speed in degrees per second. A range across 0 turns some each way (default 0). */
  spin?: Spread;
  /** "dot" (default) draws a soft round dot. "square" draws a square that narrows as it turns, like paper confetti. */
  shape?: "dot" | "square";
  /** Downward acceleration in m/s² (default 0). Negative values make particles rise. */
  gravity?: number;
  /** Constant acceleration in m/s², such as [1, 0, 0] for a breeze along x (default none). */
  wind?: Vec3;
  /** Air drag rate per second (default 0). Values of 2 to 4 suit firework sparks. */
  drag?: number;
}

/** A continuous stream of particles, such as smoke or snow. See Particles.emit. */
export interface EmitOptions extends Omit<BurstOptions, "count"> {
  /** Particles per second (default 20). */
  rate?: number;
}

/** A stream started by Particles.emit. */
export interface Emitter {
  /** Merges `options` into the stream's options while it runs. */
  set(options: EmitOptions): void;
  /** Stops emitting. Particles already out live out their lives. */
  stop(): void;
  /** Whether the stream is still emitting. */
  readonly running: boolean;
}
