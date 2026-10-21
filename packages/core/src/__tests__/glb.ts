export interface GlbImage {
  /** Embedded bytes (stored in the binary chunk) or a URI. */
  bytes?: Uint8Array;
  uri?: string;
  sampler?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number };
}

/** A translation animation of one node: keyframe times (s) and positions (x, y, z per key). */
export interface GlbAnimation {
  name: string;
  node: number;
  times: number[];
  translations: number[];
}

/**
 * A minimal binary glTF: one triangle mesh per named node, optionally with a
 * base colour texture and an animation. For tests.
 */
/** A shape key (morph target) on the mesh: its name and the offset of each of the 3 vertices. */
export interface GlbMorph {
  name: string;
  offsets: number[];
}

export const makeGlb = (
  names: string[] = ["body"],
  image?: GlbImage,
  animation?: GlbAnimation,
  morph?: GlbMorph,
  /** Where the triangle's lowest point is (default 0). */
  low = 0,
) => {
  const positions = new Float32Array([0, low, 0, 1, low, 0, 0, low + 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const imageBytes = image?.bytes ?? new Uint8Array(0);
  const times = new Float32Array(animation?.times ?? []);
  const translations = new Float32Array(animation?.translations ?? []);
  const offsets = new Float32Array(morph?.offsets ?? []);
  const pad = (n: number) => Math.ceil(n / 4) * 4;
  const imageEnd = positions.byteLength + uvs.byteLength + pad(imageBytes.byteLength);
  const morphStart = imageEnd + times.byteLength + translations.byteLength;
  const bin = new Uint8Array(morphStart + offsets.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(uvs.buffer), positions.byteLength);
  bin.set(imageBytes, positions.byteLength + uvs.byteLength);
  bin.set(new Uint8Array(times.buffer), imageEnd);
  bin.set(new Uint8Array(translations.buffer), imageEnd + times.byteLength);
  bin.set(new Uint8Array(offsets.buffer), morphStart);
  const textured = image !== undefined;
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: names.map((_, i) => i) }],
    nodes: names.map((name, i) => ({ name, mesh: 0, translation: [i, 0, 0] })),
    meshes: [
      {
        primitives: [
          {
            attributes: textured ? { POSITION: 0, TEXCOORD_0: 1 } : { POSITION: 0 },
            ...(textured ? { material: 0 } : {}),
          },
        ],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, low, 0], max: [1, low + 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength },
      {
        buffer: 0,
        byteOffset: positions.byteLength + uvs.byteLength,
        byteLength: Math.max(1, imageBytes.byteLength),
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
  if (animation) {
    const accessors = json.accessors as unknown[];
    const views = json.bufferViews as unknown[];
    views.push(
      { buffer: 0, byteOffset: imageEnd, byteLength: times.byteLength },
      { buffer: 0, byteOffset: imageEnd + times.byteLength, byteLength: translations.byteLength },
    );
    accessors.push(
      {
        bufferView: 3,
        componentType: 5126,
        count: times.length,
        type: "SCALAR",
        min: [Math.min(...times)],
        max: [Math.max(...times)],
      },
      { bufferView: 4, componentType: 5126, count: times.length, type: "VEC3" },
    );
    json.animations = [
      {
        name: animation.name,
        samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: animation.node, path: "translation" } }],
      },
    ];
  }
  if (morph) {
    const views = json.bufferViews as unknown[];
    const accessors = json.accessors as unknown[];
    views.push({ buffer: 0, byteOffset: morphStart, byteLength: offsets.byteLength });
    accessors.push({
      bufferView: views.length - 1,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [Math.min(...offsets), Math.min(...offsets), Math.min(...offsets)],
      max: [Math.max(...offsets), Math.max(...offsets), Math.max(...offsets)],
    });
    const mesh = (json.meshes as { primitives: Record<string, unknown>[]; extras?: unknown }[])[0];
    mesh.primitives[0].targets = [{ POSITION: accessors.length - 1 }];
    mesh.extras = { targetNames: [morph.name] };
  }
  if (image) {
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    json.textures = [{ source: 0, name: "paint", ...(image.sampler ? { sampler: 0 } : {}) }];
    if (image.sampler) json.samplers = [image.sampler];
    json.images = [image.uri ? { uri: image.uri } : { bufferView: 2, mimeType: "image/png" }];
  }
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  new Uint8Array(out, 20, jsonBytes.byteLength).set(jsonBytes);
  const binStart = 20 + jsonBytes.byteLength;
  view.setUint32(binStart, bin.byteLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN"
  new Uint8Array(out, binStart + 8, bin.byteLength).set(bin);
  return out;
};
