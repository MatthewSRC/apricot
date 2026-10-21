/** Default cap on the device pixel ratio. Rendering at 3× rarely looks better than at 2×. */
export const DEFAULT_MAX_PIXEL_RATIO = 2;

/** The pixel ratio to render at: `devicePixelRatio` clamped between 1 and `maxPixelRatio`. */
export const resolvePixelRatio = (devicePixelRatio: number, maxPixelRatio = DEFAULT_MAX_PIXEL_RATIO) =>
  Math.max(1, Math.min(devicePixelRatio, maxPixelRatio));

/** Drawing-buffer size in physical pixels for a layout size in points. */
export const drawingBufferSize = (widthPt: number, heightPt: number, pixelRatio: number) => ({
  width: Math.max(1, Math.floor(widthPt * pixelRatio)),
  height: Math.max(1, Math.floor(heightPt * pixelRatio)),
});
