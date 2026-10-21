// Entry point @apricotjs/core/png, separate from @apricotjs/core so apps that
// never save a picture do not carry the compressor.

import type { Pixels } from "./capture";
import { zlib } from "./deflate";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
};

/**
 * Encodes `pixels` as a PNG file, in RGB when every pixel is opaque and in
 * RGBA otherwise. Each byte is stored as its difference from the same
 * channel of the pixel to its left, which compresses the smooth shading of
 * a 3D render well.
 * `effort` sets how hard the compressor searches for repeats (default 32).
 * Higher values give smaller files and take longer.
 */
export const encodePng = (pixels: Pixels, { effort }: { effort?: number } = {}) => {
  const { width, height, data } = pixels;
  let opaque = true;
  for (let i = 3; i < data.length && opaque; i += 4) opaque = data[i] === 255;
  const channels = opaque ? 3 : 4;
  const stride = width * channels + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const out = y * stride;
    // Filter 1 ("sub") stores each byte minus the same channel of the previous pixel.
    raw[out] = 1;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      for (let c = 0; c < channels; c++) {
        const left = x > 0 ? data[from - 4 + c] : 0;
        raw[out + 1 + x * channels + c] = (data[from + c] - left) & 0xff;
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, opaque ? 2 : 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib(raw, { effort })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
};
