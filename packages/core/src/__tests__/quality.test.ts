import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_PIXEL_RATIO, drawingBufferSize, resolvePixelRatio } from "../quality";

describe("quality", () => {
  it("caps the pixel ratio and never goes below 1", () => {
    expect(resolvePixelRatio(3)).toBe(DEFAULT_MAX_PIXEL_RATIO);
    expect(resolvePixelRatio(3, 3)).toBe(3);
    expect(resolvePixelRatio(1.5)).toBe(1.5);
    expect(resolvePixelRatio(0.5)).toBe(1);
  });

  it("sizes the drawing buffer in whole physical pixels, at least 1×1", () => {
    expect(drawingBufferSize(375, 667, 2)).toEqual({ width: 750, height: 1334 });
    expect(drawingBufferSize(100.6, 50.2, 2.8125)).toEqual({ width: 282, height: 141 });
    expect(drawingBufferSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });
});
