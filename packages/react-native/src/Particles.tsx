import {
  BURSTS,
  type BurstOptions,
  EMITTERS,
  type EmitOptions,
  type Emitter,
  Particles as ParticleSet,
} from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { useAttach } from "./parent";
import { type TransformProps, useTransform } from "./transform";

/** The name of a ready-made burst. See BURSTS. */
export type BurstName = keyof typeof BURSTS;

/** The name of a ready-made stream. See EMITTERS. */
export type EmitterName = keyof typeof EMITTERS;

/** Sends bursts and starts streams. See <Particles ref>. */
export interface ParticlesHandle {
  /**
   * Sends a burst: a ready-made one by name ("sparkle", "firework", "pop",
   * "confetti") with optional overrides such as `at`, or your own options.
   */
  burst: (burst: BurstName | BurstOptions, options?: BurstOptions) => void;
  /**
   * Starts a stream: a ready-made one by name ("smoke", "fountain", "snow",
   * "sparkler") with optional overrides, or your own options (`rate` per
   * second, each particle as in a burst). Returns the emitter: `set` changes
   * it while it runs (move it with `at`) and `stop` ends it.
   */
  emit: (stream: EmitterName | EmitOptions, options?: EmitOptions) => Emitter;
}

export interface ParticlesProps extends TransformProps {
  /** Maximum number of live particles (default 1000). Beyond that, the oldest are reused. */
  max?: number;
  /**
   * Adds the particles' light to what is behind them, so they glow on a dark
   * scene such as fireworks at night. Default false: drawn over the scene,
   * which also shows on a light background.
   */
  glow?: boolean;
  /**
   * An image each particle shows, such as a leaf or a star from useTexture,
   * tinted by the particle's colour and keeping its transparency. Default: a
   * soft dot, or a square for particles with `shape: "square"`.
   */
  texture?: THREE.Texture | null;
  /**
   * A stream that runs while this is set, by name or as options. Changes
   * apply while it runs. To start streams from code, use the ref's `emit`.
   */
  emit?: EmitterName | EmitOptions | false;
  ref?: Ref<ParticlesHandle>;
}

const burstOf = (burst: BurstName | BurstOptions, options: BurstOptions) =>
  typeof burst === "string" ? { ...BURSTS[burst], ...options } : { ...burst, ...options };

const streamOf = (stream: EmitterName | EmitOptions, options: EmitOptions) =>
  typeof stream === "string" ? { ...EMITTERS[stream], ...options } : { ...stream, ...options };

/**
 * Bursts and streams of particles, such as sparks, glints, fireworks,
 * confetti, smoke or snow. Their motion is computed on the GPU, so between
 * bursts they cost the CPU nothing, and the scene sleeps again once the last
 * particle fades. Particles can change colour (`fadeTo`), grow or shrink
 * (`grow`) over their life, spin, be pushed by `wind`, and start anywhere in
 * an `area`. Keep it outside a <Bundle>, since its particles move every frame.
 *
 *   const sparks = useRef<ParticlesHandle>(null);
 *   <Particles ref={sparks} />
 *   sparks.current?.burst("confetti", { at: [0, 1, 0] });
 *   <Particles emit={{ ...EMITTERS.smoke, at: [1, 2, 0] }} />
 */
export function Particles({ max = 1000, glow = false, texture, emit, ref, ...transform }: ParticlesProps) {
  const scene = useScene();
  // The material depends on these, so a change creates a new set and ends streams started from code.
  const set = useMemo(() => new ParticleSet(max, { glow, texture }), [max, glow, texture]);
  // Particle time in seconds, advanced by each frame's delta. Frames arrive at the screen's steady
  // rate but the JS that runs them does not, so a wall clock read there would make particles judder.
  // A burst between frames starts at the last frame's time.
  const [clock] = useState(() => ({ seconds: 0 }));
  useEffect(() => () => set.dispose(), [set]);
  useAttach(set.object);
  useTransform(set.object, transform);
  // Request frames only while a particle is alive or a stream runs.
  useFrame(({ delta }) => {
    clock.seconds += delta;
    return set.update(clock.seconds);
  });

  // The `emit` prop runs one stream while it is set, and updates it in place when it changes.
  const stream = emit ? streamOf(emit, {}) : null;
  const changes = JSON.stringify(stream);
  const running = useRef<Emitter | null>(null);
  const latest = useRef(stream);
  latest.current = stream;
  const on = stream !== null;
  useEffect(() => {
    if (!on || !latest.current) return;
    const started = set.emit(latest.current, clock.seconds);
    running.current = started;
    scene.invalidate();
    return () => {
      started.stop();
      running.current = null;
    };
  }, [set, on, scene, clock]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `changes` stands for the stream's options
  useEffect(() => {
    if (latest.current) running.current?.set(latest.current);
  }, [changes]);

  useImperativeHandle(
    ref,
    () => ({
      burst: (burst, options = {}) => {
        set.burst(burstOf(burst, options), clock.seconds);
        scene.invalidate();
      },
      emit: (stream, options = {}) => {
        const started = set.emit(streamOf(stream, options), clock.seconds);
        scene.invalidate();
        return started;
      },
    }),
    [set, scene, clock],
  );
  return null;
}
