import { unzlibSync } from "fflate";
import { expect } from "vitest";
import type { Pixels } from "../capture";

/** CRC-32 as PNG has it (bit by bit: slow, plain). */
const crc32 = (bytes: Uint8Array) => {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
};

/** The chunks of a PNG file: their types and bodies, checking each one's CRC. */
export const chunksOf = (file: Uint8Array) => {
  const view = new DataView(file.buffer, file.byteOffset);
  const chunks: { type: string; body: Uint8Array }[] = [];
  for (let at = 8; at < file.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(file.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, body });
    at += 12 + length;
  }
  return chunks;
};

/** The pixels back out of a PNG made by encodePng (filter "sub" on every row). */
export const decodePng = (file: Uint8Array): Pixels => {
  const chunks = chunksOf(file);
  const header = new DataView(chunks[0].body.buffer, chunks[0].body.byteOffset);
  const [width, height, type] = [header.getUint32(0), header.getUint32(4), chunks[0].body[9]];
  const channels = type === 2 ? 3 : 4;
  const raw = unzlibSync(chunks.find((c) => c.type === "IDAT")?.body as Uint8Array);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (width * channels + 1));
    expect(row[0]).toBe(1);
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        const left = x > 0 ? data[(y * width + x - 1) * 4 + c] : 0;
        data[(y * width + x) * 4 + c] = c < channels ? (row[1 + x * channels + c] + left) & 0xff : 255;
      }
  }
  return { width, height, data };
};
