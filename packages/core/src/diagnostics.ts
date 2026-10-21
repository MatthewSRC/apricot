import type * as THREE from "three/webgpu";
import { percentiles } from "./stats";

/** One rendered frame. Times in milliseconds. */
export interface FrameRecord {
  /** Time since the recorder started. */
  at: number;
  /** Time since the previous frame started, which is what users perceive as smoothness. */
  interval: number;
  /** Time in frame callbacks (useFrame, behaviors, trips, labels). */
  callbacks: number;
  /** Time in three's render(), including culling, shader and pipeline creation, and command encoding. */
  render: number;
  /** Time in context.present(), mostly waiting for the GPU or a free buffer. */
  present: number;
  drawCalls: number;
  triangles: number;
  /** Render pipelines created during this frame. Each new pipeline, shader or node build stalls a frame. */
  newPipelines: number;
  /** Shader programs created during this frame. */
  newShaders: number;
  /** Material node builds during this frame. */
  newNodeBuilds: number;
  /** A background shader warm-up was running. */
  warming: boolean;
  /** The shadow map was redrawn (scenes with shadows only). */
  shadowMap?: boolean;
  /** Bundles recorded again this frame (scenes with <Bundle> only). */
  rerecorded?: number;
  /** GPU time of the latest measured frames in ms, with `gpuTiming` on a device that supports it. */
  gpu?: number;
}

export interface DiagnosticEvent {
  at: number;
  kind: string;
  detail?: unknown;
}

/** Counters three keeps internally. They are not public API, so they are read defensively. */
export interface RendererCounters {
  pipelines: number;
  shaders: number;
  nodeBuilds: number;
  drawCalls: number;
  triangles: number;
}

type RendererInternals = {
  _pipelines?: { caches?: Map<unknown, unknown>; programs?: Record<string, Map<unknown, unknown>> };
  _nodes?: { nodeBuilderCache?: Map<unknown, unknown> };
  info?: { render?: { drawCalls?: number; triangles?: number } };
  backend?: { adapter?: { info?: Record<string, unknown> }; device?: { limits?: Record<string, unknown> } };
};

/** Reads three's pipeline, shader and node caches and the last frame's draw calls. */
export const rendererCounters = (renderer: unknown): RendererCounters => {
  const r = (renderer ?? {}) as RendererInternals;
  const programs = r._pipelines?.programs ?? {};
  return {
    pipelines: r._pipelines?.caches?.size ?? 0,
    shaders: (programs.vertex?.size ?? 0) + (programs.fragment?.size ?? 0) + (programs.compute?.size ?? 0),
    nodeBuilds: r._nodes?.nodeBuilderCache?.size ?? 0,
    drawCalls: r.info?.render?.drawCalls ?? 0,
    triangles: r.info?.render?.triangles ?? 0,
  };
};

/** What the GPU says about itself (vendor, architecture), when the backend exposes it. */
export const adapterInfo = (renderer: unknown) => {
  const info = (renderer as RendererInternals | null)?.backend?.adapter?.info;
  if (!info) return null;
  const out: Record<string, unknown> = {};
  for (const key of ["vendor", "architecture", "device", "description"]) if (info[key]) out[key] = info[key];
  return out;
};

/** Counts what is in a scene: objects, meshes, distinct materials and geometries, triangles, lights. */
export const sceneContents = (scene: THREE.Object3D) => {
  let objects = 0;
  let meshes = 0;
  let lights = 0;
  let triangles = 0;
  const materials = new Set<unknown>();
  const geometries = new Set<unknown>();
  scene.traverse((o) => {
    objects++;
    if ((o as THREE.Light).isLight) lights++;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    const g = mesh.geometry;
    geometries.add(g);
    const count = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    triangles += (count / 3) * instances;
  });
  return {
    objects,
    meshes,
    lights,
    materials: materials.size,
    geometries: geometries.size,
    triangles: Math.round(triangles),
  };
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Records performance data: the latest frames (600 by default), the 40
 * slowest with what happened in them (new shaders or pipelines, a running
 * warm-up, time the JavaScript thread spent elsewhere), and a log of events
 * such as model loads, camera flights and warm-ups. report() returns it all
 * as plain JSON.
 */
export class Diagnostics {
  private readonly frames: FrameRecord[] = [];
  private readonly slow: FrameRecord[] = [];
  private readonly events: DiagnosticEvent[] = [];
  private readonly origin: number;

  constructor(
    private readonly capacity = 600,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.origin = now();
  }

  /** Milliseconds since the recorder started. */
  time() {
    return round(this.now() - this.origin);
  }

  /** Logs an event, such as a model load or the start of a camera flight. */
  note(kind: string, detail?: unknown) {
    this.events.push({ at: this.time(), kind, ...(detail === undefined ? {} : { detail }) });
    if (this.events.length > 300) this.events.shift();
  }

  /** Adds a frame. The 40 slowest are also kept separately, so they outlast the ring buffer. */
  frame(record: FrameRecord) {
    const rounded: FrameRecord = {
      ...record,
      at: round(record.at),
      interval: round(record.interval),
      callbacks: round(record.callbacks),
      render: round(record.render),
      present: round(record.present),
    };
    this.frames.push(rounded);
    if (this.frames.length > this.capacity) this.frames.shift();
    if (this.slow.length < 40 || rounded.interval > this.slow[this.slow.length - 1].interval) {
      this.slow.push(rounded);
      this.slow.sort((a, b) => b.interval - a.interval);
      if (this.slow.length > 40) this.slow.pop();
    }
  }

  /** Everything recorded, as plain JSON data. `extra` adds app or device details. */
  report<E extends Record<string, unknown> = Record<string, never>>(extra: E = {} as E) {
    const frames = this.frames;
    const pick = (key: keyof FrameRecord) => frames.map((f) => f[key] as number);
    const janky = frames.filter((f) => f.interval > 34);
    const report = {
      generatedAt: new Date().toISOString(),
      uptimeMs: this.time(),
      summary: {
        frames: frames.length,
        intervalMs: percentiles(pick("interval")),
        callbacksMs: percentiles(pick("callbacks")),
        renderMs: percentiles(pick("render")),
        presentMs: percentiles(pick("present")),
        ...(frames.some((f) => f.gpu !== undefined)
          ? { gpuMs: percentiles(frames.filter((f) => f.gpu !== undefined).map((f) => f.gpu as number)) }
          : {}),
        // Frames longer than two refreshes at 60 Hz, and what they had in common.
        janky: janky.length,
        jankyWithNewPipelines: janky.filter((f) => f.newPipelines > 0 || f.newShaders > 0).length,
        jankyWhileWarming: janky.filter((f) => f.warming).length,
        // Frames where most of the interval was spent outside callbacks, render and present, so the
        // JavaScript thread was busy elsewhere (React, loading, warm-up).
        jankyMostlyElsewhere: janky.filter(
          (f) => f.interval - f.callbacks - f.render - f.present > f.interval / 2,
        ).length,
      },
      slowestFrames: this.slow,
      events: this.events,
      recentFrames: frames.slice(-240),
    };
    return { ...extra, ...report } as E & typeof report;
  }
}
