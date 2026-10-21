import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { BURSTS, EMITTERS, Particles } from "../particles";

/** Particle `i`'s attribute `name` as [x, y, z, w]. */
const read = (p: Particles, name: "start" | "velocity" | "look" | "motion" | "end" | "turn", i: number) => {
  const a = (p as unknown as Record<string, THREE.InstancedBufferAttribute>)[name];
  return [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)];
};

describe("Particles", () => {
  it("draws nothing until a burst, then writes each particle's start once", () => {
    const p = new Particles(8);
    expect(p.object.frustumCulled).toBe(false);
    // Hidden while none is alive, but compiled with the rest of the scene.
    expect([p.object.visible, p.object.count, p.object.userData["apricot:compileHidden"]]).toEqual([
      false,
      8,
      true,
    ]);
    expect(p.update(0)).toBe(false);
    // Shown by the warm-up while it compiles: frames meanwhile leave it so.
    p.object.visible = true;
    p.update(0.05);
    expect(p.object.visible).toBe(true);
    p.object.visible = false;
    expect(p.object.visible).toBe(false);
    expect(read(p, "start", 0)[3]).toBeLessThan(-1000);
    p.burst(
      { at: [1, 2, 3], count: 3, colors: ["#ff0000"], speed: 2, life: 1, size: 0.1, gravity: 9.8, drag: 2 },
      5,
    );
    for (let i = 0; i < 3; i++) {
      expect(read(p, "start", i)).toEqual([1, 2, 3, 5]);
      const [vx, vy, vz, life] = read(p, "velocity", i);
      expect(Math.hypot(vx, vy, vz)).toBeCloseTo(2);
      expect(life).toBe(1);
      expect(read(p, "look", i)).toEqual([1, 0, 0, expect.closeTo(0.1)]);
      // Gravity (and wind) as one push; drag.
      expect(read(p, "motion", i)).toEqual([0, expect.closeTo(-9.8), 0, 2]);
      // Ends as it starts: the same colour and size; neither turning nor square.
      expect(read(p, "end", i)).toEqual([1, 0, 0, 1]);
      expect(read(p, "turn", i)).toEqual([0, 0, 0, 0]);
    }
    // Drawn while alive; alive until the last one's life is over.
    expect(p.object.visible).toBe(true);
    expect([p.update(5.5), p.aliveAt(5.99), p.aliveAt(6)]).toEqual([true, true, false]);
    expect(p.update(6)).toBe(false);
    expect(p.object.visible).toBe(false);
    p.burst({ count: 20 }, 7);
    expect(p.object.visible).toBe(true);
  });

  it("sends them within `spread` of `direction`", () => {
    const p = new Particles(200);
    p.burst({ count: 200, direction: [1, 0, 0], spread: 30, speed: 1 }, 0);
    for (let i = 0; i < 200; i++)
      expect(read(p, "velocity", i)[0]).toBeGreaterThanOrEqual(Math.cos(Math.PI / 6) - 1e-6);
    // Every way.
    const all = new Particles(400);
    all.burst({ count: 400, spread: 180, speed: 1 }, 0);
    const down = [...Array(400).keys()].filter((i) => read(all, "velocity", i)[1] < 0).length;
    expect(down).toBeGreaterThan(120);
    expect(down).toBeLessThan(280);
  });

  it("reuses the oldest when more are sent out than it holds", () => {
    const p = new Particles(4);
    p.burst({ count: 3, at: [1, 0, 0] }, 0);
    p.burst({ count: 3, at: [2, 0, 0] }, 1);
    expect([0, 1, 2, 3].map((i) => read(p, "start", i)[0])).toEqual([2, 2, 1, 2]);
    // A burst bigger than it holds: as many as it holds.
    p.burst({ count: 10, at: [3, 0, 0] }, 2);
    expect([0, 1, 2, 3].map((i) => read(p, "start", i)[0])).toEqual([3, 3, 3, 3]);
  });

  it("turns colour and size over a life, spins, flutters as a square, and starts over an area", () => {
    const p = new Particles(50);
    p.burst(
      {
        count: 50,
        at: [1, 2, 3],
        area: [2, 0, 4],
        colors: ["#ffffff"],
        fadeTo: "#000000",
        grow: 3,
        spin: [90, 180],
        shape: "square",
        gravity: 1,
        wind: [0.5, 0, -0.5],
      },
      0,
    );
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = read(p, "start", i);
      expect([Math.abs(x - 1) <= 1, y, Math.abs(z - 3) <= 2]).toEqual([true, 2, true]);
      expect(read(p, "end", i)).toEqual([0, 0, 0, 3]);
      const [angle, spin, square] = read(p, "turn", i);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
      expect(spin).toBeGreaterThanOrEqual(Math.PI / 2 - 1e-6);
      expect(spin).toBeLessThanOrEqual(Math.PI + 1e-6);
      expect(square).toBe(1);
      expect(read(p, "motion", i).slice(0, 3)).toEqual([0.5, -1, -0.5]);
    }
    const xs = [...Array(50).keys()].map((i) => read(p, "start", i)[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
  });

  it("streams particles evenly while emitting, until stopped", () => {
    const p = new Particles(100);
    const stream = p.emit({ rate: 10, life: 1, at: [0, 1, 0] }, 0);
    expect([stream.running, p.object.visible, p.aliveAt(100)]).toEqual([true, true, true]);
    // Half a second: five, born through it, not all at once.
    expect(p.update(0.5)).toBe(true);
    const born = [0, 1, 2, 3, 4].map((i) => read(p, "start", i)[3]);
    expect(born.map((b) => Math.round(b * 100) / 100)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(read(p, "start", 5)[3]).toBeLessThan(-1000);
    // What is owed carries over: 0.15 s more at 10 a second is one, with half of one owed.
    p.update(0.65);
    expect(read(p, "start", 5)[3]).toBeCloseTo(0.65);
    p.update(0.75);
    expect(read(p, "start", 6)[3]).toBeCloseTo(0.75);
    // Changed as it goes: 0.05 s at 100 a second, and the half owed.
    stream.set({ at: [5, 0, 0], rate: 100 });
    p.update(0.8);
    expect(read(p, "start", 7)[0]).toBe(5);
    expect(read(p, "start", 11)[3]).toBeCloseTo(0.8);
    expect(read(p, "start", 12)[3]).toBeLessThan(-1000);
    // Stopped: those out finish their lives, then it is hidden.
    stream.stop();
    expect(stream.running).toBe(false);
    expect([p.update(1.5), p.update(1.81)]).toEqual([true, false]);
    expect(p.object.visible).toBe(false);
    // A long gap sends no more than it holds.
    const all = p.emit({ rate: 1000 }, 2);
    p.update(10);
    expect(p.aliveAt(10)).toBe(true);
    p.stopAll();
    expect(all.running).toBe(false);
    p.dispose();
  });

  it("uploads just what it wrote", () => {
    const p = new Particles(10);
    const start = (p as unknown as { start: THREE.InstancedBufferAttribute }).start;
    p.burst({ count: 4 }, 0);
    expect(start.updateRanges).toEqual([{ start: 0, count: 16 }]);
    start.clearUpdateRanges();
    // Round the end and back to the start.
    p.burst({ count: 8 }, 0);
    expect(start.updateRanges).toEqual([
      { start: 16, count: 24 },
      { start: 0, count: 8 },
    ]);
  });

  it("has ready-made bursts and streams, glows when told to, and draws a picture", () => {
    const p = new Particles(500);
    for (const burst of Object.values(BURSTS)) p.burst({ ...burst, at: [0, 1, 0] }, 0);
    for (const stream of Object.values(EMITTERS)) p.emit(stream, 0);
    expect(p.update(0.1)).toBe(true);
    const pictured = new Particles(10, { texture: new THREE.Texture() });
    expect((pictured.object.material as THREE.SpriteNodeMaterial).colorNode).not.toBeNull();
    pictured.dispose();
    expect((p.object.material as THREE.Material).blending).toBe(THREE.NormalBlending);
    const glowing = new Particles(10, { glow: true });
    expect((glowing.object.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);
    glowing.dispose();
  });
});
