import { describe, expect, it } from "vitest";
import { DAY, daylightAt } from "../daylight";

describe("daylightAt", () => {
  it("puts the sun east in the morning, high at noon, west in the evening", () => {
    const morning = daylightAt(7);
    const noon = daylightAt(12);
    const evening = daylightAt(17);
    expect(morning.sunDirection.x).toBeGreaterThan(0.5);
    expect(evening.sunDirection.x).toBeLessThan(-0.5);
    expect(noon.sunDirection.y).toBeGreaterThan(morning.sunDirection.y);
    expect(noon.sunDirection.length()).toBeCloseTo(1);
  });

  it("keeps the sun in the west through dusk, while the light is still orange", () => {
    // 18:36, the sunset glow: the sun is low in the west, not the moon rising in the east.
    const dusk = daylightAt(18.6);
    expect(dusk.sunDirection.x).toBeLessThan(-0.9);
    expect(dusk.sunDirection.y).toBeGreaterThan(0);
    expect(dusk.sunIntensity).toBeGreaterThan(1);
    // Morning and dusk light come from opposite sides: their shadows fall opposite ways.
    expect(Math.sign(daylightAt(9).sunDirection.x)).toBe(-Math.sign(dusk.sunDirection.x));
  });

  it("fades the direct light out as the sun sets and the moon rises, so shadows never jump", () => {
    for (const swap of [6, 19]) {
      expect(daylightAt(swap).direct).toBe(0);
      expect(daylightAt(swap).sunIntensity).toBe(0);
      // Either side of the swap the light comes from opposite sides, but barely shines.
      const before = daylightAt(swap - 0.05);
      const after = daylightAt(swap + 0.05);
      expect(Math.sign(before.sunDirection.x)).toBe(-Math.sign(after.sunDirection.x));
      expect(before.direct).toBeLessThan(0.1);
      expect(after.direct).toBeLessThan(0.1);
    }
    expect(daylightAt(13).direct).toBe(1);
    expect(daylightAt(1).direct).toBe(1);
    // Custom times: a long summer day.
    const summer = { sunrise: 5, sunset: 21 };
    expect(daylightAt(21, DAY, 0, summer).direct).toBe(0);
    expect(daylightAt(20, DAY, 0, summer).sunDirection.x).toBeLessThan(-0.5);
    expect(daylightAt(13, DAY, 0, summer).sunDirection.y).toBeGreaterThan(0.8);
  });

  it("is bright by day and dim by night, with the moon up", () => {
    const night = daylightAt(23);
    const noon = daylightAt(13);
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity * 5);
    expect(night.sunDirection.y).toBeGreaterThan(0);
    expect(night.background.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.2);
    expect(noon.reflections).toBe(1);
  });

  it("blends between keys and wraps around midnight", () => {
    const mid = daylightAt(11); // between 9 and 13
    expect(mid.sunIntensity).toBeCloseTo((DAY[3].sunIntensity + DAY[4].sunIntensity) / 2);
    expect(daylightAt(25).sunIntensity).toBeCloseTo(daylightAt(1).sunIntensity);
    expect(daylightAt(-1).sunIntensity).toBeCloseTo(daylightAt(23).sunIntensity);
    // Between the last key (20) and the first (0, next day).
    expect(daylightAt(22).sunIntensity).toBeCloseTo((DAY[7].sunIntensity + DAY[0].sunIntensity) / 2);
  });

  it("takes custom keys and a compass offset", () => {
    const one = [
      {
        hour: 0,
        sun: "#ff0000",
        sunIntensity: 1,
        sky: "#000",
        ground: "#000",
        fillIntensity: 1,
        background: "#000",
        reflections: 1,
      },
    ];
    expect(daylightAt(12, one).sun.getHexString()).toBe("ff0000");
    expect(daylightAt(7, DAY, Math.PI).sunDirection.x).toBeLessThan(-0.5);
  });
  it("says how dark it is: day, dusk coming on before sunset, night, and back after sunrise", () => {
    const dark = (hour: number) => daylightAt(hour).dark;
    expect(dark(13)).toBe(0);
    expect(dark(17.9)).toBe(0);
    expect(dark(18.5)).toBeGreaterThan(0.2);
    expect(dark(18.5)).toBeLessThan(0.8);
    expect(dark(19)).toBeGreaterThan(0.95);
    expect(dark(23)).toBe(1);
    expect(dark(3)).toBe(1);
    expect(dark(6.5)).toBeGreaterThan(0.2);
    expect(dark(7.5)).toBe(0);
    // Whatever the colours.
    expect(
      daylightAt(
        23,
        DAY.map((k) => ({ ...k, sunIntensity: 50 })),
      ).dark,
    ).toBe(1);
  });
});
