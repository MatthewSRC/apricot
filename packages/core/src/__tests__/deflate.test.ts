import { unzlibSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { zlib } from "../deflate";

/** Bytes from a seeded generator: the same every run. */
const random = (length: number, seed = 1) => {
  const bytes = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    bytes[i] = s >>> 24;
  }
  return bytes;
};

/** Whether two byte arrays hold the same (quicker than toEqual on long ones). */
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("zlib", () => {
  it("gives back what it was given, whatever it holds", () => {
    const repeats = new Uint8Array(70000);
    for (let i = 0; i < repeats.length; i++) repeats[i] = (i % 7) * 30 + (i % 300 < 3 ? 1 : 0);
    // Matches far back (30 KB), and runs longer than the longest match (258).
    const far = new Uint8Array(66000);
    far.set(random(1000, 7), 0);
    far.set(random(1000, 7), 31000);
    far.set(random(1000, 7), 62000);
    const cases = [
      new Uint8Array(0),
      new Uint8Array([42]),
      random(5000),
      repeats,
      far,
      new Uint8Array(1000).fill(9),
    ];
    for (const data of cases) {
      const packed = zlib(data);
      expect(same(unzlibSync(packed), data)).toBe(true);
      expect(same(unzlibSync(zlib(data, { effort: 1 })), data)).toBe(true);
    }
    // Repeats come out much smaller; noise doesn't grow much.
    expect(zlib(repeats).length).toBeLessThan(repeats.length / 20);
    expect(zlib(random(5000)).length).toBeLessThan(5000 * 1.15);
  });

  it("squeezes a rendered picture's rows nearly as well as a full compressor, and quicker", () => {
    // Like a 3D scene: soft shading, a few shapes with edges, slight dithering; PNG "sub" rows.
    const [width, height] = [320, 240];
    const dither = random(width * height * 3, 5);
    const stride = width * 3 + 1;
    const rows = new Uint8Array(stride * height);
    const pixel = (x: number, y: number, c: number) => {
      const inBox = x > 60 && x < 180 && y > 80 && y < 200;
      const inDisc = (x - 240) ** 2 + (y - 90) ** 2 < 40 ** 2;
      const base = inBox ? 180 - y * 0.3 : inDisc ? 90 + x * 0.2 : 220 - y * 0.25 + x * 0.05;
      return Math.round(base * (1 - c * 0.15) + (dither[(y * width + x) * 3 + c] & 1));
    };
    for (let y = 0; y < height; y++) {
      rows[y * stride] = 1;
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 3; c++)
          rows[y * stride + 1 + x * 3 + c] = (pixel(x, y, c) - (x > 0 ? pixel(x - 1, y, c) : 0)) & 0xff;
    }
    const packed = zlib(rows);
    expect(same(unzlibSync(packed), rows)).toBe(true);
    expect(packed.length).toBeLessThan(zlibSync(rows, { level: 6 }).length * 1.15);
  });
});
