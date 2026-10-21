import type * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createShoreField, createWaterGeometry, createWaterMaterial, Waves } from "../waves";

describe("Waves", () => {
  it("rise and fall in place and travel, as high as asked", () => {
    const waves = new Waves({ height: 0.1, length: 2, speed: 1 });
    let max = 0;
    for (let i = 0; i < 400; i++) max = Math.max(max, Math.abs(waves.heightAt(i * 0.13, i * 0.07)));
    expect(max).toBeGreaterThan(0.08);
    expect(max).toBeLessThanOrEqual(0.1 * 1.73 + 1e-9);
    const before = waves.heightAt(0.3, 0.4);
    waves.tick(0.5);
    expect(waves.time.value).toBe(0.5);
    expect(waves.heightAt(0.3, 0.4)).not.toBeCloseTo(before, 4);
    expect(waves.peak.value).toBeCloseTo(0.1 * 1.73);
  });

  it("slope as their height changes", () => {
    const waves = new Waves({ height: 0.2, length: 3, direction: 30 });
    waves.tick(1.3);
    const [sx, sz] = waves.slopeAt(0.7, -0.4);
    const e = 1e-5;
    expect(sx).toBeCloseTo((waves.heightAt(0.7 + e, -0.4) - waves.heightAt(0.7 - e, -0.4)) / (2 * e), 4);
    expect(sz).toBeCloseTo((waves.heightAt(0.7, -0.4 + e) - waves.heightAt(0.7, -0.4 - e)) / (2 * e), 4);
  });

  it("keep their defaults for options left undefined (as useWaves passes them)", () => {
    // useWaves sets every option, those not given as undefined: they must not wipe the defaults.
    const waves = new Waves({ height: 0.03, length: 1.6, speed: 0.6, direction: undefined });
    waves.set({ height: 0.03, length: undefined, speed: 0.6, direction: undefined });
    expect(waves.settings).toEqual({ height: 0.03, length: 1.6, speed: 0.6, direction: 0 });
    waves.tick(0.7);
    expect(Number.isFinite(waves.heightAt(1.2, -0.4))).toBe(true);
    expect(waves.heightAt(1.2, -0.4)).not.toBe(0);
    expect(waves.slopeAt(1.2, -0.4).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(waves.peak.value)).toBe(true);
  });

  it("are flat when still, and change without a new shader", () => {
    const still = new Waves({ height: 0 });
    expect(still.heightAt(1, 2)).toBe(0);
    expect(still.slopeAt(1, 2)).toEqual([0, 0]);
    const waves = new Waves();
    const water = createWaterMaterial({ waves });
    const position = water.material.positionNode;
    waves.set({ height: 0.3, direction: 90 });
    expect(waves.settings.height).toBe(0.3);
    expect(water.material.positionNode).toBe(position);
  });
});

describe("water", () => {
  it("is opaque by default, see-through on request, and changes colour live", () => {
    expect(createWaterMaterial().material.transparent).toBe(false);
    const pool = createWaterMaterial({ waves: new Waves(), clarity: 0.6, shallow: "#00ff00" });
    expect(pool.material.transparent).toBe(true);
    expect(pool.material.depthWrite).toBe(false);
    expect(pool.material.positionNode).toBeTruthy();
    pool.set({ shallow: "#ff0000", deep: "#0000ff", clarity: 0.2, sparkle: 0 });
    pool.set({});
    expect(createWaterMaterial().material.positionNode).toBeNull();
  });

  it("lies flat in x–z, fine enough for waves", () => {
    const sheet = createWaterGeometry(4, 2, 0.5);
    sheet.computeBoundingBox();
    const b = sheet.boundingBox as THREE.Box3;
    expect([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]).toEqual(
      [-2, 2, 0, 0, -1, 1].map((v) => expect.closeTo(v)),
    );
    expect(sheet.getAttribute("position").count).toBe(9 * 5);
  });

  it("by a shore: pale by the sand to deep out at sea, foam and colours changing live", () => {
    const field = createShoreField(
      [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      ],
      [-4, -4, 4, 4],
      { size: 32 },
    );
    const beach = createWaterMaterial({ shore: field, foam: false, scale: 5 });
    const color = beach.material.colorNode;
    beach.set({ shoreline: "#ffffff", caustics: 0, glow: 0.5 });
    beach.set({ foam: "#eeeeee" });
    expect(beach.material.colorNode).toBe(color);
    expect(beach.material.emissiveNode).toBeTruthy();
  });
});

describe("shore field", () => {
  // The value at ground point (x, z) of a field over [-4, -4, 4, 4], 0 to 1.
  const valueAt = (texture: THREE.DataTexture, x: number, z: number, size: number) => {
    const col = Math.floor(((x + 4) / 8) * size);
    const row = Math.floor(((z + 4) / 8) * size);
    return (texture.image.data as Uint8Array)[(row * size + col) * 4] / 255;
  };

  it("measures how far the water is from land given as outlines", () => {
    const { texture, bounds, reach } = createShoreField(
      [
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      ],
      [-4, -4, 4, 4],
      {
        size: 64,
        reach: 2,
      },
    );
    expect(bounds).toEqual([-4, -4, 4, 4]);
    expect(reach).toBe(2);
    expect(valueAt(texture, 0, 0, 64)).toBe(0);
    // 1 m out from the edge: halfway to `reach`; 3 m out: as far as it counts.
    expect(valueAt(texture, 2, 0, 64)).toBeCloseTo(0.5, 1);
    expect(valueAt(texture, 3.9, 3.9, 64)).toBe(1);
    expect(texture.magFilter).toBe(1006);
  });

  it("measures it exactly from a land test, on any area (texels longer than wide too)", () => {
    // Scattered islands on a 12 × 5 m area, against the plain search: the distance to the nearest land texel.
    const size = 40;
    const bounds = [-6, -2, 6, 3] as const;
    const islands = [
      [-4, 1, 0.6],
      [1.5, -1, 0.9],
      [4.5, 2.2, 0.4],
    ];
    const land = (x: number, z: number) => islands.some(([ix, iz, r]) => Math.hypot(x - ix, z - iz) < r);
    const reach = 3;
    const { texture } = createShoreField(land, bounds, { size, reach });
    const at = (i: number, low: number, high: number) => low + ((i + 0.5) / size) * (high - low);
    const dry: [number, number][] = [];
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const x = at(col, -6, 6);
        const z = at(row, -2, 3);
        if (land(x, z)) dry.push([x, z]);
      }
    let worst = 0;
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++) {
        const x = at(col, -6, 6);
        const z = at(row, -2, 3);
        const plain = Math.min(reach, ...dry.map(([dx, dz]) => Math.hypot(x - dx, z - dz)));
        const value = (texture.image.data as Uint8Array)[(row * size + col) * 4] / 255;
        worst = Math.max(worst, Math.abs(value * reach - plain));
      }
    // Exact but for storing it in 8 bits.
    expect(worst).toBeLessThanOrEqual(reach / 255 / 2 + 1e-9);
    // No land at all: far everywhere.
    const sea = createShoreField(() => false, bounds, { size: 8 });
    expect([...(sea.texture.image.data as Uint8Array)].every((v) => v === 255)).toBe(true);
  });

  it("measures it from a test of where there is land", () => {
    const size = 64;
    const { texture } = createShoreField((x) => x > 1, [-4, -4, 4, 4], { size, reach: 2 });
    expect(valueAt(texture, 3, 0, size)).toBe(0);
    expect(valueAt(texture, 0, 2, size)).toBeCloseTo(0.5, 1);
    expect(valueAt(texture, -3.5, -2, size)).toBe(1);
  });
});
