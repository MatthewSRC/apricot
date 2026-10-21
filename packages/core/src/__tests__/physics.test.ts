import { describe, expect, it } from "vitest";
import { type Bounds, SphereWorld } from "../physics";
import { seededRandom } from "../random";

const box: Bounds = { min: [-2, 0, -0.5], max: [2, 100, 0.5] };

const runUntilAsleep = (world: SphereWorld, seconds = 20, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) if (!world.step(dt)) return t;
  return Number.POSITIVE_INFINITY;
};

const maxOverlap = (world: SphereWorld) => {
  let worst = 0;
  const p = world.position;
  for (let i = 0; i < world.count; i++)
    for (let j = i + 1; j < world.count; j++) {
      const d = Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
      worst = Math.max(worst, world.radius[i] + world.radius[j] - d);
    }
  return worst;
};

describe("SphereWorld", () => {
  it("drops a body onto the floor and goes to sleep", () => {
    const world = new SphereWorld({ capacity: 1, bounds: box });
    expect(world.add({ position: [0, 5, 0], radius: 0.5 })).toBe(0);
    expect(world.isAsleep).toBe(false);
    expect(runUntilAsleep(world)).toBeLessThan(3);
    expect(world.isAsleep).toBe(true);
    expect(world.position[1]).toBeCloseTo(0.5, 2);
    // Asleep: stepping is free and reports no motion.
    expect(world.step(1 / 60)).toBe(false);
  });

  it("piles bodies up inside the box without overlap", () => {
    const random = seededRandom(4);
    const world = new SphereWorld({ capacity: 40, bounds: box });
    for (let i = 0; i < 40; i++) {
      world.add({ position: [(random() * 2 - 1) * 1.5, 2 + i * 0.8, 0], radius: 0.3 + random() * 0.05 });
    }
    expect(runUntilAsleep(world)).toBeLessThan(15);
    for (let i = 0; i < world.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const p = world.position[i * 3 + axis];
        expect(p - world.radius[i]).toBeGreaterThanOrEqual(box.min[axis] - 1e-6);
        expect(p + world.radius[i]).toBeLessThanOrEqual(box.max[axis] + 1e-6);
      }
    }
    expect(maxOverlap(world)).toBeLessThan(0.3 * 0.15);
    // A pile, not a tower: 40 bodies of ~0.65 across in a 4-wide box stay low.
    const top = Math.max(...Array.from({ length: 40 }, (_, i) => world.position[i * 3 + 1]));
    expect(top).toBeLessThan(5);
  });

  it("slides a body dropped off-centre onto another down beside it", () => {
    const world = new SphereWorld({ capacity: 2, bounds: box });
    world.add({ position: [0, 0.5, 0], radius: 0.5 });
    world.add({ position: [0.3, 3, 0], radius: 0.5 });
    runUntilAsleep(world);
    expect(world.position[4]).toBeLessThan(1.2);
  });

  it("separates coincident bodies and never launches them faster than maxSpeed", () => {
    const world = new SphereWorld({ capacity: 2, bounds: box, maxSpeed: 5, gravity: [0, 0, 0] });
    world.add({ position: [0, 5, 0], radius: 0.5 });
    world.add({ position: [0, 5, 0], radius: 0.5 });
    const before = [world.position[1], world.position[4]];
    world.step(1 / 60);
    const moved = Math.abs(world.position[4] - before[1]) + Math.abs(world.position[1] - before[0]);
    expect(moved).toBeGreaterThan(0.5);
    world.step(1 / 60);
    const travelled = Math.abs(world.position[4] - before[1] - 0.5);
    expect(travelled).toBeLessThan(5 / 60 + 0.5);
  });

  it("rolls bodies that move along the floor and tumbles free ones", () => {
    const world = new SphereWorld({
      capacity: 2,
      bounds: { min: [-50, 0, -1], max: [50, 50, 1] },
      contactDamping: 0,
    });
    world.add({ position: [0, 0.5, 0], radius: 0.5, velocity: [3, 0, 0] });
    world.add({ position: [0, 20, 0], radius: 0.5, angularVelocity: [0, 0, 2], gravity: undefined } as never);
    for (let i = 0; i < 10; i++) world.step(1 / 60);
    // Rolling towards +x turns the body about -z.
    expect(world.rotation[2]).toBeLessThan(-0.05);
    // The falling one spins about +z.
    expect(world.rotation[6]).toBeGreaterThan(0.05);
    const norm = Math.hypot(world.rotation[4], world.rotation[5], world.rotation[6], world.rotation[7]);
    expect(norm).toBeCloseTo(1, 6);
  });

  it("keeps bodies in a box narrower than they are", () => {
    const world = new SphereWorld({ capacity: 1, bounds: { min: [-0.1, 0, -0.1], max: [0.1, 10, 0.1] } });
    world.add({ position: [3, 2, -3], radius: 0.5 });
    world.step(1 / 60);
    expect(world.position[0]).toBeCloseTo(0);
    expect(world.position[2]).toBeCloseTo(0);
  });

  it("pushes bodies back under a lowered ceiling and wakes on setBounds", () => {
    const world = new SphereWorld({ capacity: 1, bounds: box });
    world.add({ position: [0, 1, 0], radius: 0.5 });
    runUntilAsleep(world);
    world.setBounds({ min: [-2, -1, -0.5], max: [2, 0.2, 0.5] });
    expect(world.isAsleep).toBe(false);
    world.step(1 / 60);
    expect(world.position[1]).toBeLessThanOrEqual(-0.3 + 1e-9);
  });

  it("refuses bodies over capacity, reports free spots, and ignores empty steps", () => {
    const world = new SphereWorld({ capacity: 1, bounds: box });
    expect(world.step(1 / 60)).toBe(false);
    world.add({ position: [0, 1, 0], radius: 0.5 });
    expect(world.add({ position: [1, 1, 0], radius: 0.5 })).toBe(-1);
    expect(world.count).toBe(1);
    expect(world.isFree([0, 1.5, 0], 0.5)).toBe(false);
    expect(world.isFree([0, 3, 0], 0.5)).toBe(true);
    expect(world.step(0)).toBe(true);
    expect(world.step(-1)).toBe(true);
  });

  it("splits long frames into substeps", () => {
    const fast = new SphereWorld({ capacity: 1, bounds: box, gravity: [0, -10, 0], maxSubstep: 1 / 1000 });
    const coarse = new SphereWorld({ capacity: 1, bounds: box, gravity: [0, -10, 0], maxSubstep: 1 });
    fast.add({ position: [0, 50, 0], radius: 0.5 });
    coarse.add({ position: [0, 50, 0], radius: 0.5 });
    fast.step(0.1);
    coarse.step(0.1);
    // Exact free fall: 50 − ½·10·0.1² = 49.95. More substeps get closer.
    expect(Math.abs(fast.position[1] - 49.95)).toBeLessThan(Math.abs(coarse.position[1] - 49.95));
  });
});
