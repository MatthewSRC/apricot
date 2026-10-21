// A small zlib compressor (RFC 1950/1951) for PNG images. It finds LZ77
// matches over a 32 KB window and writes them in blocks, each with Huffman
// codes built for its symbols. The output is slightly larger than the best
// compressors produce, for a few KB of code instead of a library.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195,
  227, 258,
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097,
  6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
// The order the code length code's own lengths are written in.
const LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const WINDOW = 32768;
const HASH = 1 << 15;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
// A match this long ends the search for a longer one.
const NICE = 64;
// Symbols per block. Each block gets its own Huffman codes.
const BLOCK = 1 << 15;

/** The length code (0–28) for each match length 3–258. */
const LENGTH_CODE = new Uint8Array(MAX_MATCH + 1);
for (let code = 0; code < 28; code++)
  for (let n = LENGTH_BASE[code]; n < LENGTH_BASE[code] + (1 << LENGTH_EXTRA[code]); n++)
    LENGTH_CODE[n] = code;
LENGTH_CODE[MAX_MATCH] = 28;

/** The distance code (0–29) for each distance 1–32768: direct below 257, then by its top bits. */
const NEAR_CODE = new Uint8Array(257);
const FAR_CODE = new Uint8Array(256);
for (let code = 0; code < 30; code++)
  for (let d = DISTANCE_BASE[code]; d < DISTANCE_BASE[code] + (1 << DISTANCE_EXTRA[code]); d++) {
    if (d <= 256) NEAR_CODE[d] = code;
    else FAR_CODE[(d - 1) >> 7] = code;
  }
const distanceCode = (d: number) => (d <= 256 ? NEAR_CODE[d] : FAR_CODE[(d - 1) >> 7]);

/** Writes bits least significant first, as deflate packs them. */
class Bits {
  bytes: Uint8Array;
  length = 0;
  private bit = 0;
  private pending = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(Math.max(256, size));
  }

  write(value: number, count: number) {
    this.pending |= value << this.bit;
    this.bit += count;
    while (this.bit >= 8) {
      if (this.length === this.bytes.length) {
        const grown = new Uint8Array(this.bytes.length * 2);
        grown.set(this.bytes);
        this.bytes = grown;
      }
      this.bytes[this.length++] = this.pending & 0xff;
      this.pending >>>= 8;
      this.bit -= 8;
    }
  }

  flush() {
    if (this.bit > 0) this.write(0, 8 - this.bit);
  }
}

/**
 * Huffman code lengths (at most `limit` bits) for symbols seen `counts`
 * times; 0 for those never seen. At least two symbols get a code, as some
 * decoders want.
 */
const codeLengths = (counts: Uint32Array, limit: number) => {
  const n = counts.length;
  const lengths = new Uint8Array(n);
  const weights = Array.from(counts);
  let used = weights.filter((w) => w > 0).length;
  for (let s = 0; used < 2 && s < n; s++)
    if (weights[s] === 0) {
      weights[s] = 1;
      used++;
    }
  for (;;) {
    // A Huffman tree: join the two lightest until one is left; a leaf's depth is its length.
    const parent = new Int32Array(2 * n).fill(-1);
    const heap: [number, number][] = [];
    for (let s = 0; s < n; s++) if (weights[s] > 0) heap.push([weights[s], s]);
    heap.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let next = n;
    // Two sorted queues: the leaves, and the joined nodes, which are created in order.
    const joined: [number, number][] = [];
    const take = () => {
      if (joined.length && (!heap.length || joined[0][0] < heap[0][0]))
        return joined.shift() as [number, number];
      return heap.shift() as [number, number];
    };
    while (heap.length + joined.length > 1) {
      const a = take();
      const b = take();
      parent[a[1]] = next;
      parent[b[1]] = next;
      joined.push([a[0] + b[0], next++]);
    }
    let longest = 0;
    for (let s = 0; s < n; s++) {
      if (weights[s] === 0) continue;
      let depth = 0;
      for (let p = parent[s]; p !== -1; p = parent[p]) depth++;
      lengths[s] = depth;
      longest = Math.max(longest, depth);
    }
    if (longest <= limit) return lengths;
    // Too deep, so the weights are flattened and the tree is built again.
    for (let s = 0; s < n; s++) if (weights[s] > 0) weights[s] = (weights[s] >> 1) | 1;
  }
};

/** The codes for `lengths` (canonical, as deflate defines them), bit-reversed to be written least significant first. */
const codesFor = (lengths: Uint8Array) => {
  const count = new Uint16Array(16);
  for (const l of lengths) if (l) count[l]++;
  const next = new Uint16Array(16);
  for (let bits = 1, code = 0; bits < 16; bits++) {
    code = (code + count[bits - 1]) << 1;
    next[bits] = code;
  }
  const codes = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) {
    const l = lengths[s];
    if (!l) continue;
    let code = next[l]++;
    let reversed = 0;
    for (let i = 0; i < l; i++, code >>= 1) reversed = (reversed << 1) | (code & 1);
    codes[s] = reversed;
  }
  return codes;
};

/** `lengths` as deflate stores them: runs of the same length, and of zeros, shortened (symbols 16–18 and their extra bits). */
const runLengths = (lengths: Uint8Array) => {
  const out: [number, number][] = [];
  for (let i = 0; i < lengths.length; ) {
    const l = lengths[i];
    let run = 1;
    while (i + run < lengths.length && lengths[i + run] === l) run++;
    i += run;
    if (l === 0) {
      while (run >= 11) {
        const n = Math.min(run, 138);
        out.push([18, n - 11]);
        run -= n;
      }
      if (run >= 3) {
        out.push([17, run - 3]);
        run = 0;
      }
      for (; run > 0; run--) out.push([0, 0]);
    } else {
      out.push([l, 0]);
      run--;
      while (run >= 3) {
        const n = Math.min(run, 6);
        out.push([16, n - 3]);
        run -= n;
      }
      for (; run > 0; run--) out.push([l, 0]);
    }
  }
  return out;
};

/** Writes one block of symbols (literals 0–255, end 256, or a length with `distances`) with codes made for them. */
const writeBlock = (
  out: Bits,
  symbols: Uint16Array,
  extras: Uint16Array,
  distances: Uint16Array,
  count: number,
  last: boolean,
) => {
  const literalCounts = new Uint32Array(286);
  const distanceCounts = new Uint32Array(30);
  for (let i = 0; i < count; i++) {
    literalCounts[symbols[i]]++;
    if (symbols[i] > 256) distanceCounts[distanceCode(distances[i])]++;
  }
  literalCounts[256]++;
  const literalLengths = codeLengths(literalCounts, 15);
  const distanceLengths = codeLengths(distanceCounts, 15);
  let hlit = 286;
  while (hlit > 257 && literalLengths[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && distanceLengths[hdist - 1] === 0) hdist--;
  const all = new Uint8Array(hlit + hdist);
  all.set(literalLengths.subarray(0, hlit));
  all.set(distanceLengths.subarray(0, hdist), hlit);
  const runs = runLengths(all);
  const lengthCounts = new Uint32Array(19);
  for (const [s] of runs) lengthCounts[s]++;
  const lengthLengths = codeLengths(lengthCounts, 7);
  let hclen = 19;
  while (hclen > 4 && lengthLengths[LENGTH_ORDER[hclen - 1]] === 0) hclen--;

  out.write(last ? 1 : 0, 1);
  out.write(2, 2);
  out.write(hlit - 257, 5);
  out.write(hdist - 1, 5);
  out.write(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) out.write(lengthLengths[LENGTH_ORDER[i]], 3);
  const lengthCodes = codesFor(lengthLengths);
  for (const [s, extra] of runs) {
    out.write(lengthCodes[s], lengthLengths[s]);
    if (s === 16) out.write(extra, 2);
    else if (s === 17) out.write(extra, 3);
    else if (s === 18) out.write(extra, 7);
  }
  const literalCodes = codesFor(literalLengths);
  const distanceCodes = codesFor(distanceLengths);
  for (let i = 0; i < count; i++) {
    const s = symbols[i];
    out.write(literalCodes[s], literalLengths[s]);
    if (s <= 256) continue;
    const code = s - 257;
    if (LENGTH_EXTRA[code]) out.write(extras[i], LENGTH_EXTRA[code]);
    const d = distances[i];
    const dc = distanceCode(d);
    out.write(distanceCodes[dc], distanceLengths[dc]);
    if (DISTANCE_EXTRA[dc]) out.write(d - DISTANCE_BASE[dc], DISTANCE_EXTRA[dc]);
  }
  out.write(literalCodes[256], literalLengths[256]);
};

const adler32 = (data: Uint8Array) => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    // Sums stay exact for 5552 bytes between the modulos.
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
};

/**
 * Compresses `data` as a zlib stream, the format PNG uses. `effort` is how
 * many earlier positions each match search checks (default 32). Higher
 * values find longer matches and are slower.
 */
export const zlib = (data: Uint8Array, { effort = 32 }: { effort?: number } = {}) => {
  const out = new Bits(data.length / 3 + 256);
  // Header 0x78 0x01: deflate, 32 KB window, no dictionary, with valid check bits.
  out.write(0x78, 8);
  out.write(0x01, 8);
  const head = new Int32Array(HASH).fill(-1);
  const previous = new Int32Array(WINDOW).fill(-1);
  const symbols = new Uint16Array(BLOCK);
  const extras = new Uint16Array(BLOCK);
  const distances = new Uint16Array(BLOCK);
  let count = 0;
  const end = data.length;
  const insert = (i: number) => {
    if (i + MIN_MATCH > end) return;
    const h = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH - 1);
    previous[i & (WINDOW - 1)] = head[h];
    head[h] = i;
  };
  let i = 0;
  while (i < end) {
    let best = 0;
    let distance = 0;
    if (i + MIN_MATCH <= end) {
      const limit = Math.min(MAX_MATCH, end - i);
      const h = ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH - 1);
      let candidate = head[h];
      for (let tries = effort; candidate >= 0 && i - candidate <= WINDOW && tries > 0; tries--) {
        if (data[candidate + best] === data[i + best] && data[candidate] === data[i]) {
          let n = 0;
          while (n < limit && data[candidate + n] === data[i + n]) n++;
          if (n > best) {
            best = n;
            distance = i - candidate;
            if (n >= NICE || n === limit) break;
          }
        }
        const next = previous[candidate & (WINDOW - 1)];
        if (next >= candidate) break;
        candidate = next;
      }
    }
    if (best >= MIN_MATCH) {
      const code = LENGTH_CODE[best];
      symbols[count] = 257 + code;
      extras[count] = best - LENGTH_BASE[code];
      distances[count++] = distance;
      for (const stop = i + best; i < stop; i++) insert(i);
    } else {
      symbols[count++] = data[i];
      insert(i);
      i++;
    }
    if (count === BLOCK) {
      writeBlock(out, symbols, extras, distances, count, false);
      count = 0;
    }
  }
  writeBlock(out, symbols, extras, distances, count, true);
  out.flush();
  const check = adler32(data);
  for (const shift of [24, 16, 8, 0]) out.write((check >>> shift) & 0xff, 8);
  return out.bytes.slice(0, out.length);
};
