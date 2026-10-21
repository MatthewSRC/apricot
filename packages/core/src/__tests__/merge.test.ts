import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { mergeColoredParts } from "../merge";

describe("mergeColoredParts", () => {
  it("bakes parts into one indexed geometry with vertex colours", () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(0.5, 8, 6);
    const merged = mergeColoredParts([
      { geometry: box, color: "#ff0000" },
      {
        geometry: sphere,
        color: (p) => (p.y > 0 ? "#00ff00" : "#0000ff"),
        matrix: new THREE.Matrix4().makeTranslation(0, 3, 0),
      },
    ]);
    const boxCount = box.getAttribute("position").count;
    const sphereCount = sphere.getAttribute("position").count;
    expect(merged.getAttribute("position").count).toBe(boxCount + sphereCount);
    expect(merged.getAttribute("uv")).toBeUndefined();
    expect(merged.index?.count).toBe((box.index?.count ?? 0) + (sphere.index?.count ?? 0));
    const color = merged.getAttribute("color");
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 0, 0]);
    // Sphere vertices moved up by 3: all above the box, all green (y > 0).
    const position = merged.getAttribute("position");
    for (let i = boxCount; i < boxCount + sphereCount; i++) {
      expect(position.getY(i)).toBeGreaterThan(2);
      expect(color.getY(i)).toBe(1);
    }
    // Indices of the second part point at its own vertices.
    const index = merged.index as THREE.BufferAttribute;
    expect(index.getX(box.index?.count ?? 0)).toBeGreaterThanOrEqual(boxCount);
    expect(merged.boundingSphere).not.toBeNull();
    // Inputs are untouched.
    expect(sphere.getAttribute("position").getY(0)).toBeCloseTo(0.5);
  });

  it("indexes non-indexed parts and computes missing normals", () => {
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    const merged = mergeColoredParts([{ geometry: triangle, color: "white" }]);
    expect(Array.from(merged.index?.array ?? [])).toEqual([0, 1, 2]);
    expect(merged.getAttribute("normal").getZ(0)).toBeCloseTo(1);
    expect(merged.index?.array).toBeInstanceOf(Uint16Array);
  });

  it('keeps a part\'s own painted colours with "vertex"', () => {
    const painted = new THREE.PlaneGeometry(1, 1);
    const count = painted.getAttribute("position").count;
    painted.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(0.25), 3));
    const merged = mergeColoredParts([
      { geometry: painted, color: "vertex" },
      { geometry: new THREE.PlaneGeometry(1, 1), color: "#ffffff" },
    ]);
    const colors = merged.getAttribute("color");
    expect(colors.getX(0)).toBeCloseTo(0.25);
    expect(colors.getX(count)).toBeCloseTo(1);
    expect(() => mergeColoredParts([{ geometry: new THREE.PlaneGeometry(), color: "vertex" }])).toThrow(
      /color attribute/,
    );
  });

  it("places parts as three would: positions by the matrix, normals turned and unit length", () => {
    const box = new THREE.BoxGeometry(1, 2, 3, 2, 2, 2);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(1, -2, 0.5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.4)),
      new THREE.Vector3(2, 0.5, 1.5),
    );
    const merged = mergeColoredParts([{ geometry: box, color: "white", matrix }]);
    const expected = box.clone().applyMatrix4(matrix);
    for (const name of ["position", "normal"]) {
      const got = Array.from(merged.getAttribute(name).array);
      const want = Array.from(expected.getAttribute(name).array);
      for (const [i, x] of got.entries()) expect(x).toBeCloseTo(want[i], 5);
    }
    // Interleaved parts too.
    const interleaved = new THREE.BufferGeometry();
    const data = new THREE.InterleavedBuffer(
      new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]),
      6,
    );
    interleaved.setAttribute("position", new THREE.InterleavedBufferAttribute(data, 3, 0));
    interleaved.setAttribute("normal", new THREE.InterleavedBufferAttribute(data, 3, 3));
    const flat = mergeColoredParts([{ geometry: interleaved, color: "white" }]);
    expect(Array.from(flat.getAttribute("position").array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(flat.getAttribute("normal").array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it("switches to 32-bit indices for large geometries", () => {
    const big = new THREE.PlaneGeometry(1, 1, 300, 300); // 90,601 vertices
    expect(mergeColoredParts([{ geometry: big, color: "white" }]).index?.array).toBeInstanceOf(Uint32Array);
  });
});
