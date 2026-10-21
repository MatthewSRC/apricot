import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createApple, createPeach } from "../fruit";

describe("createApple", () => {
  it("is one vertex-coloured mesh with a collision radius", () => {
    const apple = createApple();
    expect(apple).toBeInstanceOf(THREE.Mesh);
    expect(apple.name).toBe("Apple");
    expect(apple.userData.radius).toBe(0.5);
    expect((apple.material as THREE.MeshStandardNodeMaterial).vertexColors).toBe(true);
    expect(apple.geometry.getAttribute("color")).toBeDefined();
    // About as wide as the size, with the stem and leaf on top.
    apple.geometry.computeBoundingBox();
    const box = apple.geometry.boundingBox as THREE.Box3;
    expect(box.max.x - box.min.x).toBeGreaterThan(0.95);
    expect(box.max.x - box.min.x).toBeLessThan(1.25);
    expect(box.max.y).toBeGreaterThan(0.55);
    expect(box.min.y).toBeGreaterThan(-0.55);
  });

  it("has red skin, a brown stem and a green leaf", () => {
    const apple = createApple();
    const color = apple.geometry.getAttribute("color");
    const position = apple.geometry.getAttribute("position");
    let red = 0;
    let green = 0;
    let topY = Number.NEGATIVE_INFINITY;
    let topColor = new THREE.Color();
    for (let i = 0; i < color.count; i++) {
      const c = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
      if (c.r > c.g * 2 && c.r > c.b * 2) red++;
      if (c.g > c.r * 1.5 && c.g > c.b) green++;
      if (position.getY(i) > topY) {
        topY = position.getY(i);
        topColor = c;
      }
    }
    expect(red).toBeGreaterThan(color.count / 2);
    expect(green).toBeGreaterThan(50);
    // The highest point is the stem or the leaf, not skin.
    expect(topColor.r > topColor.g * 2 && topColor.r > topColor.b * 2).toBe(false);
  });

  it("supports size, colour and no leaf", () => {
    const small = createApple({ size: 0.5 });
    expect(small.userData.radius).toBe(0.25);
    small.geometry.computeBoundingBox();
    expect((small.geometry.boundingBox as THREE.Box3).max.x).toBeLessThan(0.35);
    const plain = createApple({ leaf: false, color: "#7bc043" });
    expect(plain.geometry.getAttribute("position").count).toBeLessThan(
      createApple().geometry.getAttribute("position").count,
    );
    const c = plain.geometry.getAttribute("color");
    expect(c.getY(c.count / 2)).toBeGreaterThan(c.getX(c.count / 2));
  });
});

describe("createPeach", () => {
  const parts = (peach: THREE.Object3D) => peach.children as THREE.Mesh[];
  const box = (mesh: THREE.Mesh) => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox as THREE.Box3;
  };

  it("is a fuzzy two-lobed skin and glossy leaves, with a collision radius", () => {
    const peach = createPeach();
    expect(peach.name).toBe("Peach");
    expect(peach.userData.radius).toBe(0.5);
    const [skin, leaves] = parts(peach);
    expect(skin.name).toBe("Peach skin");
    const material = skin.material as THREE.MeshPhysicalNodeMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.sheen).toBeGreaterThan(0);
    // About a unit wide, a little wider than tall.
    const size = box(skin).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.04, 1);
    expect(size.x).toBeGreaterThan(size.y);
    // The crease, right of centre like the emoji's: deeper than the big left lobe beside it.
    const position = skin.geometry.getAttribute("position");
    let crease = 0;
    let lobe = 0;
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      if (Math.abs(y) > 0.05) continue;
      if (Math.abs(x - 0.1) < 0.012) crease = Math.max(crease, z);
      if (Math.abs(x + 0.05) < 0.02) lobe = Math.max(lobe, z);
    }
    expect(crease).toBeLessThan(lobe - 0.01);
    // Orange skin, blushing red on one side.
    const colors = skin.geometry.getAttribute("color");
    const color = new THREE.Color().fromBufferAttribute(colors, 0);
    expect(color.r).toBeGreaterThan(color.b);
    // Stem and two leaves above the skin, green and brown.
    expect(box(leaves).max.y).toBeGreaterThan(box(skin).max.y);
    expect((leaves.material as THREE.Material).side).toBe(THREE.DoubleSide);
  });

  it("keeps its leaves clear of the skin, all over each leaf", () => {
    const [skin, leaves] = parts(createPeach());
    // Only the top of the skin can meet the leaves: test against that (much faster).
    const all = skin.geometry.toNonIndexed().getAttribute("position");
    const cap: number[] = [];
    for (let i = 0; i < all.count; i += 3) {
      if (Math.max(all.getY(i), all.getY(i + 1), all.getY(i + 2)) > 0.3)
        for (let k = i; k < i + 3; k++) cap.push(all.getX(k), all.getY(k), all.getZ(k));
    }
    const top = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(cap, 3));
    // Rays from inside the skin must hit its inner side too.
    const surface = new THREE.Mesh(top, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const position = leaves.geometry.getAttribute("position");
    const color = leaves.geometry.getAttribute("color");
    const index = leaves.geometry.getIndex() as THREE.BufferAttribute;
    const ray = new THREE.Raycaster();
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const point = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(0, -1, 0);
    let inside = 0;
    let checked = 0;
    let gap = Number.POSITIVE_INFINITY;
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      // Leaf triangles only (green); the stem's base sits in the dimple on purpose.
      if (color.getY(ids[0]) <= color.getX(ids[0])) continue;
      ids.forEach((id, k) => {
        corners[k].fromBufferAttribute(position, id);
      });
      // Edge midpoints and the centre: between the corners, where a leaf would cut through the skin.
      for (const [a, b] of [
        [0.5, 0.5],
        [0.5, 0],
        [0, 0.5],
        [1 / 3, 1 / 3],
      ]) {
        point
          .copy(corners[0])
          .multiplyScalar(a)
          .addScaledVector(corners[1], b)
          .addScaledVector(corners[2], 1 - a - b);
        checked++;
        // Inside the skin: an odd number of crossings straight up.
        ray.set(point, up);
        if (ray.intersectObject(surface).length % 2 === 1) inside++;
        ray.set(point, down);
        const below = ray.intersectObject(surface)[0];
        if (below) gap = Math.min(gap, below.distance);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(inside).toBe(0);
    // Not just outside: clear of it, so the skin never flickers through.
    expect(gap).toBeGreaterThan(0.015);
  }, 20000);

  it("supports size, a coarser skin and no leaves", () => {
    const fine = parts(createPeach())[0].geometry.getAttribute("position").count;
    const coarse = parts(createPeach({ detail: 0 }))[0].geometry.getAttribute("position").count;
    expect(coarse).toBeLessThan(fine / 4);
    const big = createPeach({ size: 2 });
    expect(big.scale.x).toBe(2);
    expect(big.userData.radius).toBe(1);
    const withLeaves = parts(createPeach())[1].geometry.getAttribute("position").count;
    const bare = parts(createPeach({ leaves: false }))[1].geometry.getAttribute("position").count;
    expect(bare).toBeLessThan(withLeaves);
  });
});
