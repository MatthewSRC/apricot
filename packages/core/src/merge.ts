import * as THREE from "three/webgpu";

export interface ColoredPart {
  geometry: THREE.BufferGeometry;
  /**
   * One colour, a colour per vertex from its (transformed) position, or
   * "vertex" for the geometry's own `color` attribute (painted beforehand).
   */
  color: THREE.ColorRepresentation | ((position: THREE.Vector3) => THREE.ColorRepresentation) | "vertex";
  /** Transform applied to the part (default none). */
  matrix?: THREE.Matrix4;
}

// Where an attribute's values are: the array, the stride between vertices, and the offset of the first.
// Interleaved attributes share one array. Normalized attributes (quantized models) give null and are
// read through getX.
type Source = { array: ArrayLike<number>; stride: number; offset: number } | null;
const sourceOf = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Source => {
  if (attribute.normalized) return null;
  const interleaved = attribute as THREE.InterleavedBufferAttribute;
  if (interleaved.isInterleavedBufferAttribute)
    return { array: interleaved.data.array, stride: interleaved.data.stride, offset: interleaved.offset };
  return { array: attribute.array, stride: attribute.itemSize, offset: 0 };
};

/**
 * Bakes several parts into one indexed geometry with position, normal and
 * vertex colour (`color`) attributes, so a multi-part object (an apple body,
 * stem and leaf) is drawn in one call with one `vertexColors` material.
 * UVs are dropped. Input geometries are not modified: they are read and
 * transformed straight into the merged arrays, without intermediate copies.
 */
export const mergeColoredParts = (parts: readonly ColoredPart[]) => {
  let vertexCount = 0;
  let indexCount = 0;
  const prepared = parts.map(({ geometry, color, matrix }) => {
    let g = geometry;
    // A part without normals gets them computed on a copy.
    if (!g.getAttribute("normal")) {
      g = g.clone();
      g.computeVertexNormals();
    }
    const count = g.getAttribute("position").count;
    vertexCount += count;
    indexCount += g.index ? g.index.count : count;
    return { g, color, matrix, copied: g !== geometry };
  });

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  const normalMatrix = new THREE.Matrix3();
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const { g, color, matrix, copied } of prepared) {
    const position = g.getAttribute("position");
    const normal = g.getAttribute("normal");
    const index = g.index;
    const own = color === "vertex" ? g.getAttribute("color") : null;
    if (color === "vertex" && !own)
      throw new Error('mergeColoredParts: color "vertex" needs a color attribute');
    const fixed =
      typeof color === "function" || own ? null : c.set(color as THREE.ColorRepresentation).clone();
    const m = matrix?.elements;
    if (matrix) normalMatrix.getNormalMatrix(matrix);
    const nm = normalMatrix.elements;
    const p = sourceOf(position);
    const q = sourceOf(normal);
    for (let i = 0; i < position.count; i++) {
      if (p) {
        const at = p.offset + i * p.stride;
        v.set(p.array[at], p.array[at + 1], p.array[at + 2]);
      } else v.fromBufferAttribute(position, i);
      if (q) {
        const at = q.offset + i * q.stride;
        n.set(q.array[at], q.array[at + 1], q.array[at + 2]);
      } else n.fromBufferAttribute(normal, i);
      if (m) {
        const { x, y, z } = v;
        v.set(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
        const { x: a, y: b, z: d } = n;
        n.set(
          nm[0] * a + nm[3] * b + nm[6] * d,
          nm[1] * a + nm[4] * b + nm[7] * d,
          nm[2] * a + nm[5] * b + nm[8] * d,
        );
        n.normalize();
      }
      const o = (vertexOffset + i) * 3;
      positions[o] = v.x;
      positions[o + 1] = v.y;
      positions[o + 2] = v.z;
      normals[o] = n.x;
      normals[o + 1] = n.y;
      normals[o + 2] = n.z;
      const vertexColor =
        fixed ??
        (own
          ? c.setRGB(own.getX(i), own.getY(i), own.getZ(i))
          : c.set((color as (p: THREE.Vector3) => THREE.ColorRepresentation)(v)));
      colors[o] = vertexColor.r;
      colors[o + 1] = vertexColor.g;
      colors[o + 2] = vertexColor.b;
    }
    if (index) {
      const from = index.array;
      for (let i = 0; i < index.count; i++) indices[indexOffset + i] = from[i] + vertexOffset;
      indexOffset += index.count;
    } else {
      // A non-indexed part uses every vertex in order.
      for (let i = 0; i < position.count; i++) indices[indexOffset + i] = vertexOffset + i;
      indexOffset += position.count;
    }
    vertexOffset += position.count;
    if (copied) g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
};
