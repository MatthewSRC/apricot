import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { adapterInfo, Diagnostics, rendererCounters, sceneContents } from "../diagnostics";

const frame = (interval: number, extra: Partial<Parameters<Diagnostics["frame"]>[0]> = {}) => ({
  at: 0,
  interval,
  callbacks: 1,
  render: 2,
  present: 1,
  drawCalls: 10,
  triangles: 1000,
  newPipelines: 0,
  newShaders: 0,
  newNodeBuilds: 0,
  warming: false,
  ...extra,
});

describe("Diagnostics", () => {
  it("keeps recent frames, the slowest ones and events, and summarises the janky ones", () => {
    let now = 1000;
    const d = new Diagnostics(5, () => now);
    now += 50;
    d.note("warm-up started");
    d.note("camera", { view: "top" });
    for (let i = 0; i < 10; i++) d.frame(frame(16.66));
    d.frame(frame(120, { newPipelines: 3, newShaders: 4 }));
    d.frame(frame(80, { warming: true }));
    d.frame(frame(60, { callbacks: 1, render: 1, present: 1 }));
    const report = d.report({ app: "test" });
    expect(report.app).toBe("test");
    expect(report.uptimeMs).toBe(50);
    expect(report.recentFrames).toHaveLength(5);
    expect(report.slowestFrames[0].interval).toBe(120);
    expect(report.slowestFrames[0].newPipelines).toBe(3);
    expect(report.summary.janky).toBe(3);
    expect(report.summary.jankyWithNewPipelines).toBe(1);
    expect(report.summary.jankyWhileWarming).toBe(1);
    expect(report.summary.jankyMostlyElsewhere).toBe(3);
    expect(report.events.map((e) => e.kind)).toEqual(["warm-up started", "camera"]);
    expect(report.events[1].detail).toEqual({ view: "top" });
    // Plain JSON.
    expect(JSON.parse(JSON.stringify(report)).summary.frames).toBe(5);
  });

  it("keeps only the 40 slowest frames and the last 300 events", () => {
    const d = new Diagnostics(10);
    for (let i = 0; i < 100; i++) d.frame(frame(i));
    for (let i = 0; i < 350; i++) d.note("tick");
    const report = d.report();
    expect(report.slowestFrames).toHaveLength(40);
    expect(report.slowestFrames[39].interval).toBe(60);
    expect(report.events).toHaveLength(300);
  });
});

describe("renderer and scene probes", () => {
  it("reads three's caches defensively", () => {
    expect(rendererCounters(null)).toEqual({
      pipelines: 0,
      shaders: 0,
      nodeBuilds: 0,
      drawCalls: 0,
      triangles: 0,
    });
    const fake = {
      _pipelines: {
        caches: new Map([[1, 1]]),
        programs: {
          vertex: new Map([[1, 1]]),
          fragment: new Map([
            [1, 1],
            [2, 2],
          ]),
        },
      },
      _nodes: { nodeBuilderCache: new Map([[1, 1]]) },
      info: { render: { drawCalls: 7, triangles: 99 } },
      backend: { adapter: { info: { vendor: "arm", architecture: "valhall", device: "" } } },
    };
    expect(rendererCounters(fake)).toEqual({
      pipelines: 1,
      shaders: 3,
      nodeBuilds: 1,
      drawCalls: 7,
      triangles: 99,
    });
    expect(adapterInfo(fake)).toEqual({ vendor: "arm", architecture: "valhall" });
    expect(adapterInfo({})).toBeNull();
  });

  it("counts a scene's contents", () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicNodeMaterial();
    const box = new THREE.BoxGeometry();
    scene.add(
      new THREE.Mesh(box, material),
      new THREE.Mesh(box, [material, new THREE.MeshBasicNodeMaterial()]),
    );
    const many = new THREE.InstancedMesh(new THREE.PlaneGeometry(), material, 5);
    scene.add(many, new THREE.AmbientLight());
    const soup = new THREE.BufferGeometry();
    soup.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    scene.add(new THREE.Mesh(soup, material));
    expect(sceneContents(scene)).toEqual({
      objects: 6,
      meshes: 4,
      lights: 1,
      materials: 2,
      geometries: 3,
      triangles: 12 + 12 + 2 * 5 + 1,
    });
  });
});
