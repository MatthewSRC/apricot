/** A picture as pixels: RGBA, 4 bytes each, rows from the top. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

// WebGPU flag values. react-native-webgpu and browsers define them as globals, but tests may not.
const COPY_DST = 0x08;
const MAP_READ = 0x01;
const READ = 0x01;

// Copies a row of `width` RGBA (or BGRA) pixels from `from` to `to`, undoing the premultiplied alpha a
// transparent scene has.
const copyRow = (
  from: Uint8Array,
  start: number,
  to: Uint8Array,
  at: number,
  width: number,
  bgra: boolean,
) => {
  for (let x = 0; x < width * 4; x += 4) {
    const a = from[start + x + 3];
    const k = a === 255 || a === 0 ? 1 : 255 / a;
    const r = from[start + x + (bgra ? 2 : 0)];
    const b = from[start + x + (bgra ? 0 : 2)];
    to[at + x] = Math.min(255, Math.round(r * k));
    to[at + x + 1] = Math.min(255, Math.round(from[start + x + 1] * k));
    to[at + x + 2] = Math.min(255, Math.round(b * k));
    to[at + x + 3] = a;
  }
};

/**
 * Reads the pixels of `texture`, such as a frame drawn to the screen before
 * it is presented. Returns RGBA whatever the texture's channel order, with
 * premultiplied alpha undone.
 */
export const readTexture = async (device: GPUDevice, texture: GPUTexture): Promise<Pixels> => {
  const { width, height } = texture;
  // Rows of a copy are padded to 256 bytes.
  const row = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: row * height, usage: COPY_DST | MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: row }, { width, height });
  device.queue.submit([encoder.finish()]);
  try {
    await buffer.mapAsync(READ);
    const padded = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    const bgra = texture.format.startsWith("bgra");
    for (let y = 0; y < height; y++) copyRow(padded, y * row, data, y * width * 4, width, bgra);
    buffer.unmap();
    return { width, height, data };
  } finally {
    buffer.destroy();
  }
};

/**
 * Reads the frame just drawn into a WebGL 2 context, before the browser
 * presents it. Returns RGBA rows from the top, with premultiplied alpha
 * undone. The context's framebuffer and buffer bindings are kept.
 */
export const readWebGL = (gl: WebGL2RenderingContext): Pixels => {
  const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
  const rows = new Uint8Array(width * height * 4);
  const framebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  const packBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rows);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuffer);
  const data = new Uint8Array(rows.length);
  // WebGL rows start at the bottom.
  for (let y = 0; y < height; y++)
    copyRow(rows, (height - 1 - y) * width * 4, data, y * width * 4, width, false);
  return { width, height, data };
};

/**
 * Shrinks `pixels` to fit within `width` × `height`, keeping the aspect
 * ratio. Never enlarges. Each new pixel is the average of those it covers.
 */
export const shrinkPixels = (pixels: Pixels, width: number, height: number): Pixels => {
  const scale = Math.min(1, width / pixels.width, height / pixels.height);
  if (scale >= 1) return pixels;
  const w = Math.max(1, Math.round(pixels.width * scale));
  const h = Math.max(1, Math.round(pixels.height * scale));
  const data = new Uint8Array(w * h * 4);
  const { data: from, width: fw, height: fh } = pixels;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * fh) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * fh) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * fw) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * fw) / w));
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * fw + sx) * 4;
          r += from[i];
          g += from[i + 1];
          b += from[i + 2];
          a += from[i + 3];
        }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      data[o] = Math.round(r / n);
      data[o + 1] = Math.round(g / n);
      data[o + 2] = Math.round(b / n);
      data[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data };
};
