import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { Bounds } from "../physics";
import { Pile, type PileItem } from "../pile";

const area: Bounds = { min: [-2, -4, -0.4], max: [2, 4, 0.4] };
const item = (radius = 0.3, scale?: number): PileItem => ({
  geometry: new THREE.SphereGeometry(radius),
  material: new THREE.MeshStandardNodeMaterial(),
  radius,
  scale,
});

const run = (pile: Pile, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) if (!pile.step(dt)) return t;
  return Number.POSITIVE_INFINITY;
};

describe("Pile", () => {
  it("drops everything within the duration and settles on the floor", () => {
    const pile = new Pile({ items: [item()], count: 30, duration: 2, bounds: area });
    const mesh = pile.object.getObjectByName("Pile:0") as THREE.InstancedMesh;
    expect(mesh.count).toBe(0);
    expect(mesh.frustumCulled).toBe(false);
    run(pile, 1);
    expect(pile.count).toBeGreaterThan(5);
    expect(pile.count).toBeLessThan(30);
    expect(pile.isSettled).toBe(false);
    const settledAt = run(pile, 20);
    expect(settledAt).toBeLessThan(10);
    expect(pile.count).toBe(30);
    expect(mesh.count).toBe(30);
    expect(pile.isSettled).toBe(true);
    // Everything ends up inside the area (on screen).
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < 30; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.x).toBeGreaterThanOrEqual(area.min[0]);
      expect(p.x).toBeLessThanOrEqual(area.max[0]);
      expect(p.y).toBeGreaterThanOrEqual(area.min[1]);
      expect(p.y).toBeLessThanOrEqual(area.max[1]);
    }
  });

  it("writes rotation and scale into the instance matrices", () => {
    const pile = new Pile({ items: [item(0.3, 2)], count: 1, duration: 0, bounds: area, scale: [1, 1] });
    pile.step(1 / 60);
    const mesh = pile.object.getObjectByName("Pile:0") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(position, rotation, scale);
    expect(scale.x).toBeCloseTo(2);
    expect(scale.y).toBeCloseTo(2);
    const q = pile.world.rotation;
    expect(Math.abs(rotation.dot(new THREE.Quaternion(q[0], q[1], q[2], q[3])))).toBeCloseTo(1);
    expect(position.y).toBeCloseTo(pile.world.position[1]);
    // Scale also grows the collision radius.
    expect(pile.world.radius[0]).toBeCloseTo(0.6);
    // Appears just above the area.
    expect(position.y).toBeGreaterThan(area.max[1]);
    // Its bounds follow the copies (shadows are fitted to them): measured again after they move.
    mesh.computeBoundingBox();
    const before = (mesh.boundingBox as THREE.Box3).max.y;
    pile.step(0.2);
    expect(mesh.boundingBox).toBeNull();
    mesh.computeBoundingBox();
    expect((mesh.boundingBox as THREE.Box3).max.y).toBeLessThan(before);
  });

  it("mixes kinds, one instanced mesh each, and keeps sizes in range", () => {
    const pile = new Pile({ items: [item(0.2), item(0.3)], count: 40, duration: 0.5, bounds: area, seed: 9 });
    run(pile, 1);
    const a = pile.object.getObjectByName("Pile:0") as THREE.InstancedMesh;
    const b = pile.object.getObjectByName("Pile:1") as THREE.InstancedMesh;
    expect(a.count + b.count).toBe(40);
    expect(a.count).toBeGreaterThan(5);
    expect(b.count).toBeGreaterThan(5);
    for (let i = 0; i < 40; i++) {
      const r = pile.world.radius[i];
      const ok =
        (r >= 0.2 * 0.9 - 1e-9 && r <= 0.2 * 1.1 + 1e-9) || (r >= 0.3 * 0.9 - 1e-9 && r <= 0.3 * 1.1 + 1e-9);
      expect(ok).toBe(true);
    }
  });

  it("is reproducible for a seed", () => {
    const final = (seed: number) => {
      const pile = new Pile({ items: [item()], count: 10, duration: 0.5, bounds: area, seed });
      run(pile, 2);
      return Array.from(pile.world.position);
    };
    expect(final(3)).toEqual(final(3));
    expect(final(3)).not.toEqual(final(4));
  });

  it("follows new bounds and keeps objects inside", () => {
    const pile = new Pile({ items: [item()], count: 10, duration: 0.2, bounds: area });
    run(pile, 10);
    expect(pile.isSettled).toBe(true);
    const narrow: Bounds = { min: [-1, -3, -0.4], max: [1, 3, 0.4] };
    pile.setBounds(narrow);
    expect(pile.isSettled).toBe(false);
    run(pile, 10);
    for (let i = 0; i < 10; i++) {
      expect(Math.abs(pile.world.position[i * 3])).toBeLessThanOrEqual(1);
      expect(pile.world.position[i * 3 + 1]).toBeGreaterThanOrEqual(-3);
    }
  });

  it("validates items, accepts an empty count and disposes its meshes", () => {
    expect(() => new Pile({ items: [], count: 1, bounds: area })).toThrow(/at least one item/);
    const empty = new Pile({ items: [item()], count: 0, bounds: area });
    expect(empty.step(1 / 60)).toBe(false);
    expect(empty.isSettled).toBe(true);
    const parent = new THREE.Group();
    const pile = new Pile({ items: [item()], count: 2, bounds: area, duration: 1 });
    parent.add(pile.object);
    const mesh = pile.object.children[0] as THREE.InstancedMesh;
    let disposed = false;
    mesh.addEventListener("dispose", () => {
      disposed = true;
    });
    pile.dispose();
    expect(parent.children).toHaveLength(0);
    expect(disposed).toBe(true);
  });

  it("keeps the loop awake while objects are still to come, even if the rest are asleep", () => {
    const pile = new Pile({ items: [item()], count: 2, duration: 20, bounds: area });
    // Spawn times ≈ 0–8 s and 10–18 s: the first lands and sleeps long before the second.
    run(pile, 9.9);
    expect(pile.count).toBe(1);
    expect(pile.world.isAsleep).toBe(true);
    expect(pile.step(1 / 60)).toBe(true);
  });
});
