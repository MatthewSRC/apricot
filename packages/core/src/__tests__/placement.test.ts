import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  alongWall,
  cornersOf,
  covers,
  facesWall,
  fingerAngle,
  floorPoint,
  footprintOf,
  gridNear,
  gridNearEach,
  hangOn,
  hungOverlap,
  keepInside,
  keepOn,
  leaveOutOfFootprint,
  overlap,
  type Placed,
  separate,
  snap,
  snapToWalls,
  snapTurn,
  turnedFootprint,
  twist,
  wallPoint,
  wallsAlong,
  wallsAround,
  wallsOf,
} from "../placement";

describe("footprintOf", () => {
  it("leaves out what is marked, and counts it again once unmarked", () => {
    const palm = new THREE.Group();
    palm.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3)));
    const fronds = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2));
    palm.add(fronds);
    leaveOutOfFootprint(fronds);
    expect(footprintOf(palm)?.maxX).toBeCloseTo(0.15);
    leaveOutOfFootprint(fronds, false);
    expect(footprintOf(palm)?.maxX).toBeCloseTo(1);
  });

  it("measures what an object covers in its own space, whatever its own place and turn", () => {
    const sofa = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 1));
    seat.position.set(0.5, 0.25, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2));
    back.position.set(0.5, 0.5, -0.6);
    sofa.add(seat, back);
    sofa.position.set(10, 0, 4);
    sofa.rotation.y = 1.2;
    new THREE.Scene().add(sofa);
    const fp = footprintOf(sofa) as NonNullable<ReturnType<typeof footprintOf>>;
    expect(fp.minX).toBeCloseTo(-0.5);
    expect(fp.maxX).toBeCloseTo(1.5);
    expect(fp.minZ).toBeCloseTo(-0.7);
    expect(fp.maxZ).toBeCloseTo(0.5);
    expect(fp.minY).toBeCloseTo(0);
    expect(fp.maxY).toBeCloseTo(1);
  });

  it("measures all the copies of instanced meshes, and none of an empty set", () => {
    const row = new THREE.Group();
    const copies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 2);
    copies.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0.5, 0));
    copies.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0.5, 0));
    row.add(copies);
    const fp = footprintOf(row) as NonNullable<ReturnType<typeof footprintOf>>;
    expect(fp.minX).toBeCloseTo(-2.5);
    expect(fp.maxX).toBeCloseTo(2.5);
    copies.count = 0;
    expect(footprintOf(row)).toBeNull();
  });

  it("is null with nothing to measure yet (a model still loading)", () => {
    expect(footprintOf(new THREE.Group())).toBeNull();
    const empty = new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry()));
    expect(footprintOf(empty)).toBeNull();
  });
});

describe("turnedFootprint", () => {
  const fp = { minX: -1, maxX: 1, minZ: -0.25, maxZ: 0.25 };
  it("is the same unturned or turned round once, and swaps sides at a quarter turn", () => {
    expect(turnedFootprint(fp, 0).maxX).toBeCloseTo(1);
    expect(turnedFootprint(fp, 360).maxZ).toBeCloseTo(0.25);
    const quarter = turnedFootprint(fp, 90);
    expect(quarter.maxX).toBeCloseTo(0.25);
    expect(quarter.maxZ).toBeCloseTo(1);
    // At 45°, the box round the turned footprint is wider than either side.
    expect(turnedFootprint(fp, 45).maxX).toBeCloseTo((1 + 0.25) / Math.SQRT2);
  });

  it("follows three's turn direction", () => {
    // +x turned 90° round +y points to -z.
    const turned = turnedFootprint({ minX: 0, maxX: 1, minZ: 0, maxZ: 0 }, 90);
    expect(turned.minZ).toBeCloseTo(-1);
    const object = new THREE.Object3D();
    object.rotation.y = Math.PI / 2;
    expect(new THREE.Vector3(1, 0, 0).applyEuler(object.rotation).z).toBeCloseTo(-1);
  });
});

describe("snap and snapTurn", () => {
  it("rounds to the step, or leaves free with 0", () => {
    expect(snap(0.37, 0.1)).toBeCloseTo(0.4);
    expect(snap(-0.37, 0.25)).toBeCloseTo(-0.25);
    expect(snap(0.37, 0)).toBe(0.37);
  });
  it("keeps turns within 0–360", () => {
    expect(snapTurn(98, 15)).toBe(105);
    expect(snapTurn(-20, 15)).toBe(345);
    expect(snapTurn(359, 15)).toBe(0);
    expect(snapTurn(400, 0)).toBe(40);
  });
});

describe("keepInside", () => {
  const room = [-2, -2, 2, 2] as const;
  const fp = { minX: -0.5, maxX: 0.5, minZ: -0.25, maxZ: 0.25 };
  it("leaves an object inside where it is, and moves one past a wall back to it", () => {
    expect(keepInside(1, 0, fp, room)).toEqual([1, 0]);
    expect(keepInside(3, -5, fp, room)).toEqual([1.5, -1.75]);
  });
  it("centres something larger than the room", () => {
    expect(keepInside(3, 0, { minX: -3, maxX: 3, minZ: 0, maxZ: 0 }, room)[0]).toBe(0);
  });
});

describe("floorPoint", () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 5, 5);
  camera.lookAt(0, 0, 0);

  it("finds where a point of the view looks at the floor", () => {
    expect(floorPoint(camera, 50, 50, 100, 100)?.length()).toBeCloseTo(0);
    // Points lower on the screen hit the floor nearer the camera.
    expect((floorPoint(camera, 50, 90, 100, 100) as THREE.Vector3).z).toBeGreaterThan(0);
    // A raised floor (a table top).
    expect(floorPoint(camera, 50, 50, 100, 100, 1)?.y).toBeCloseTo(1);
  });

  it("misses looking up or past the far plane, and without a view", () => {
    const level = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    level.position.set(0, 0.5, 0);
    level.lookAt(0, 0.5, -1);
    // Above the middle, the line of sight points up and misses the floor.
    expect(floorPoint(level, 50, 40, 100, 100)).toBeNull();
    // Just below the middle, the hit is beyond the far plane.
    expect(floorPoint(level, 50, 51, 100, 100)).toBeNull();
    expect(floorPoint(level, 50, 99, 100, 100)).not.toBeNull();
    expect(floorPoint(camera, 0, 0, 0, 100)).toBeNull();
  });
});

describe("twist", () => {
  it("measures how far two fingers turned, the short way round", () => {
    const flat = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const down = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(fingerAngle(flat)).toBe(0);
    expect(twist(flat, down)).toBeCloseTo(90);
    expect(twist(down, flat)).toBeCloseTo(-90);
    // Across ±180 the twist still takes the short way.
    const left = [
      { x: 0, y: 0 },
      { x: -10, y: 1 },
    ];
    const leftUp = [
      { x: 0, y: 0 },
      { x: -10, y: -1 },
    ];
    expect(Math.abs(twist(left, leftUp))).toBeLessThan(20);
    expect(fingerAngle([{ x: 0, y: 0 }])).toBe(0);
  });
});

// A 1 m × 0.5 m box centred on its origin.
const box = { minX: -0.5, maxX: 0.5, minZ: -0.25, maxZ: 0.25 };
const at = (x: number, z: number, turn = 0, footprint = box): Placed => ({ x, z, turn, footprint });

describe("overlap", () => {
  it("is null for things apart or just touching", () => {
    expect(overlap(at(0, 0), at(2, 0))).toBeNull();
    expect(overlap(at(0, 0), at(1, 0))).toBeNull();
    expect(overlap(at(0, 0), at(0, 0.5))).toBeNull();
  });

  it("is the shortest way out, away from the other", () => {
    const push = overlap(at(0, 0), at(0.9, 0)) as [number, number];
    expect(push[0]).toBeCloseTo(-0.1);
    expect(push[1]).toBeCloseTo(0);
    const up = overlap(at(0, 0.4), at(0, 0)) as [number, number];
    expect(up[0]).toBeCloseTo(0);
    expect(up[1]).toBeCloseTo(0.1);
  });

  it("follows turns: a box turned a quarter is narrow along x", () => {
    // Turned 90°, it reaches 0.25 along x, so 0.8 apart clears the other's 0.5 + 0.25.
    expect(overlap(at(0, 0), at(0.8, 0, 90))).toBeNull();
    expect(overlap(at(0, 0), at(0.8, 0, 0))).not.toBeNull();
    // At 45° its corner reaches further than its sides.
    expect(overlap(at(0, 0), at(1.02, 0, 45))).not.toBeNull();
  });

  it("uses each footprint's own centre, off its origin", () => {
    const offCentre = { minX: 0, maxX: 1, minZ: -0.25, maxZ: 0.25 };
    expect(overlap(at(0, 0), at(0.6, 0, 0, offCentre))).toBeNull();
    expect(overlap(at(0, 0), at(0.4, 0, 0, offCentre))).not.toBeNull();
  });
});

describe("separate", () => {
  it("slides out of what it overlaps, and stays put when clear", () => {
    expect(separate(at(0, 0), [at(3, 0)])).toEqual([0, 0]);
    const [x, z] = separate(at(0.2, 0.1), [at(1, 0)]) as [number, number];
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(0.1);
  });

  it("keeps inside the bounds while moving out, and gives up when wedged", () => {
    const bounds = [-1, -1, 1, 1] as const;
    // Pushed left by the box on the right but stopped by the wall, so there is no room.
    expect(separate(at(-0.3, 0), [at(0.4, 0)], bounds)).toBeNull();
    const [x, z] = separate(at(0.6, 0), [], bounds) as [number, number];
    expect(x).toBeCloseTo(0.5);
    expect(z).toBeCloseTo(0);
  });

  it("ends touching, not overlapping", () => {
    const placed = separate(at(0.3, 0), [at(1, 0), at(-0.6, 0.6)]) as [number, number];
    expect(overlap(at(...placed), at(1, 0))).toBeNull();
  });
});

describe("covers and keepOn", () => {
  it("tells whether a point is on a turned footprint", () => {
    expect(covers(at(0, 0), 0.45, 0)).toBe(true);
    expect(covers(at(0, 0), 0, 0.3)).toBe(false);
    expect(covers(at(0, 0, 90), 0, 0.45)).toBe(true);
  });

  it("keeps something on top of a turned surface", () => {
    const desk = at(2, 0, 90, { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 });
    const mug = { minX: -0.05, maxX: 0.05, minZ: -0.05, maxZ: 0.05 };
    // The desk is turned 90°, so it spans 1 m either way along z and 0.5 m along x.
    const [x, z] = keepOn(2.8, 3, mug, 0, desk);
    expect(x).toBeCloseTo(2.45);
    expect(z).toBeCloseTo(0.95);
    expect(keepOn(2, 0.5, mug, 0, desk)).toEqual([expect.closeTo(2), expect.closeTo(0.5)]);
  });
});

describe("snapToWalls", () => {
  const walls = wallsOf([-2, -1.5, 2, 1.5]);
  it("moves flush against a wall within reach, and leaves it otherwise", () => {
    const near = (x: number, z: number, turn = 0) =>
      snapToWalls(x, z, box, turn, walls, 0.1).map((v) => +v.toFixed(6));
    expect(near(0, -1.17)).toEqual([0, -1.25]);
    expect(near(1.42, 0)).toEqual([1.5, 0]);
    expect(near(0, -1)).toEqual([0, -1]);
    // In a corner it snaps against both walls.
    expect(near(1.45, -1.2)).toEqual([1.5, -1.25]);
  });

  it("snaps against walls at any angle, whatever the turn", () => {
    // A room with a wall at 45° across its corner, from (1, -1) to (2, 0), facing the origin.
    const angled = wallsAround([
      [-2, -1],
      [1, -1],
      [2, 0],
      [2, 1],
      [-2, 1],
    ]);
    const [x, z] = snapToWalls(1.1, -0.05, box, 45, angled, 0.2);
    // Its nearest corner touches the angled face.
    const corners = cornersOf({ x, z, turn: 45, footprint: box });
    const out = Math.min(...corners.map(([cx, cz]) => ((cx - 1) * -1 + (cz + 1) * 1) / Math.SQRT2));
    expect(out).toBeCloseTo(0, 6);
  });
});

describe("walls", () => {
  const bounds = [-2, -1.5, 2, 1.5] as const;
  const walls = wallsOf(bounds);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(4, 4, 4);
  camera.lookAt(0, 1, 0);

  it("are seen from inside only from the room's side", () => {
    const eye = new THREE.Vector3(4, 4, 4);
    expect(walls.map((w) => facesWall(w, eye))).toEqual([true, false, false, true]);
  });

  it("meet the line of sight on the nearest wall seen from inside", () => {
    // Straight at the middle of the back wall, at 1 m up.
    camera.position.set(0, 1, 6);
    camera.lookAt(0, 1, -1.5);
    const hit = wallPoint(camera, 50, 50, 100, 100, walls);
    expect(hit?.wall.index).toBe(0);
    expect(hit?.point.x).toBeCloseTo(0);
    expect(hit?.point.y).toBeCloseTo(1);
    expect(hit?.point.z).toBeCloseTo(-1.5);
    // Above the top of the walls nothing is hit.
    camera.lookAt(0, 4, -1.5);
    expect(wallPoint(camera, 50, 50, 100, 100, walls)).toBeNull();
    expect(wallPoint(camera, 50, 50, 0, 100, walls)).toBeNull();
  });

  it("tell whether hung things overlap on their wall", () => {
    const frame = { minX: -0.2, maxX: 0.2, minY: -0.15, maxY: 0.15, minZ: 0, maxZ: 0.03 };
    const at = (x: number, y: number) => ({ position: [x, y, -1.5] as const, extent: frame });
    expect(hungOverlap(walls[0], at(0, 1.2), at(0.3, 1.3))).toBe(true);
    // Touching side by side does not count as overlapping.
    expect(hungOverlap(walls[0], at(0, 1.2), at(0.4, 1.2))).toBe(false);
    expect(hungOverlap(walls[0], at(0, 1.2), at(0.1, 1.5))).toBe(false);
    // Along the right wall, z is the direction along it.
    const right = (z: number) => ({ position: [2, 1.2, z] as const, extent: frame });
    expect(hungOverlap(walls[1], right(0), right(0.3))).toBe(true);
    expect(hungOverlap(walls[1], right(0), right(0.5))).toBe(false);
  });

  it("hang things with their backs to the wall, inside its corners and height", () => {
    const frame = { minX: -0.2, maxX: 0.2, minY: -0.15, maxY: 0.15, minZ: 0, maxZ: 0.03 };
    const back = walls[0];
    expect(hangOn(back, new THREE.Vector3(0.5, 1.2, -1.5), [0, 0], frame)).toEqual([0.5, 1.2, -1.5]);
    // A point past the corner and above the top is kept on the wall.
    const kept = hangOn(back, new THREE.Vector3(1.95, 2.35, -1.5), [0, 0], frame) as number[];
    expect(kept[0]).toBeCloseTo(1.8);
    expect(kept[1]).toBeCloseTo(2.25);
    // On the right wall the frame faces in, with its back (local -z) against x = 2.
    const right = walls[1];
    const hung = new THREE.Object3D();
    hung.position.set(
      ...(hangOn(right, new THREE.Vector3(2, 1, 1.45), [0, 0], frame) as [number, number, number]),
    );
    hung.rotation.y = THREE.MathUtils.degToRad(right.turn);
    new THREE.Scene().add(hung);
    hung.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.03).translate(0, 0, 0.015)));
    const b = new THREE.Box3().setFromObject(hung);
    expect(b.max.x).toBeCloseTo(2);
    expect(b.min.x).toBeCloseTo(1.97);
    expect(b.max.z).toBeCloseTo(1.5);
    // Snapped to the grid and moved clear of another frame.
    const other = { position: [0, 1.2, -1.5] as const, extent: frame };
    const moved = hangOn(back, new THREE.Vector3(0.21, 1.22, -1.5), [0, 0], frame, {
      grid: 0.1,
      others: [other],
    }) as number[];
    expect(moved[0]).toBeCloseTo(0.4);
    expect(moved[1]).toBeCloseTo(1.2);
    // Wedged between two frames and a corner, there is no room.
    expect(
      hangOn(wallsOf(bounds, 0.3)[0], new THREE.Vector3(1.8, 0.15, -1.5), [0, 0], frame, {
        others: [{ position: [1.5, 0.15, -1.5], extent: frame }],
      }),
    ).toBeNull();
    // On the front and left walls too.
    for (const wall of [walls[2], walls[3]]) {
      const p = hangOn(
        wall,
        new THREE.Vector3(wall.index === 2 ? 0 : -2, 1, wall.index === 2 ? 1.5 : 0),
        [0, 0],
        frame,
      );
      const o = new THREE.Object3D();
      o.position.set(...(p as [number, number, number]));
      o.rotation.y = THREE.MathUtils.degToRad(wall.turn);
      o.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.03).translate(0, 0, 0.015)));
      const ob = new THREE.Box3().setFromObject(o);
      if (wall.index === 2) expect(ob.max.z).toBeCloseTo(1.5);
      else expect(ob.min.x).toBeCloseTo(-2);
    }
  });
});

describe("walls of any shape", () => {
  const frame = { minX: -0.2, maxX: 0.2, minY: -0.15, maxY: 0.15, minZ: 0, maxZ: 0.03 };
  // The bounding box of a frame hung at `position` and turned `turn`.
  const boxOf = (position: readonly number[], turn: number) => {
    const o = new THREE.Object3D();
    o.position.set(position[0], position[1], position[2]);
    o.rotation.y = THREE.MathUtils.degToRad(turn);
    o.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.03).translate(0, 0, 0.015)));
    new THREE.Scene().add(o);
    return new THREE.Box3().setFromObject(o);
  };

  it("face into a room of any shape, whichever way its outline goes round", () => {
    // An L shape with the notch at the front right.
    const l: [number, number][] = [
      [-2, -1.5],
      [2, -1.5],
      [2, 0],
      [0, 0],
      [0, 1.5],
      [-2, 1.5],
    ];
    for (const outline of [l, [...l].reverse()]) {
      const walls = wallsAround(outline, 2.6, 4);
      expect(walls.map((w) => w.index)).toEqual([4, 5, 6, 7, 8, 9]);
      expect(walls.every((w) => w.height === 2.6)).toBe(true);
      // Each face looks into the room, so a step out from its middle is inside the L.
      for (const w of walls) {
        const mx = (w.from[0] + w.to[0]) / 2 + w.inward[0] * 0.1;
        const mz = (w.from[1] + w.to[1]) / 2 + w.inward[1] * 0.1;
        const inside =
          (mx > -2 && mx < 2 && mz > -1.5 && mz < 0) || (mx > -2 && mx < 0 && mz > -1.5 && mz < 1.5);
        expect(inside).toBe(true);
      }
    }
    // The rectangle's walls match wallsOf's except for where they start.
    const square = wallsAround([
      [-2, -1.5],
      [2, -1.5],
      [2, 1.5],
      [-2, 1.5],
    ]);
    expect(square.map((w) => w.turn)).toEqual(wallsOf([-2, -1.5, 2, 1.5]).map((w) => w.turn));
  });

  it("hang things on an angled wall, their backs on it and facing out from it", () => {
    // Across a corner at 45°, from (1, -1.5) to (2, -0.5), facing the room.
    const [, angled] = wallsAround([
      [-2, -1.5],
      [1, -1.5],
      [2, -0.5],
      [2, 1.5],
      [-2, 1.5],
    ]);
    expect(angled.turn).toBeCloseTo(315);
    const middle = new THREE.Vector3(1.5, 1.2, -1);
    expect(alongWall(angled, 1.5, -1)).toBeCloseTo(Math.SQRT2 / 2);
    const p = hangOn(angled, middle, [0, 0], frame) as [number, number, number];
    expect(p[1]).toBeCloseTo(1.2);
    // Its back is on the face, at the middle of the wall.
    expect(p[0]).toBeCloseTo(1.5);
    expect(p[2]).toBeCloseTo(-1);
    // Kept between the wall's ends. The wall is 1.41 m long and the frame 0.4 m wide.
    const end = hangOn(angled, new THREE.Vector3(2, 1.2, -0.5), [0, 0], frame) as number[];
    expect(alongWall(angled, end[0], end[2])).toBeCloseTo(Math.SQRT2 - 0.2);
    // Its local +z faces out from the wall, so the front is 0.03 m out and the back is on the face.
    const o = new THREE.Object3D();
    o.position.set(p[0], p[1], p[2]);
    o.rotation.y = THREE.MathUtils.degToRad(angled.turn);
    o.updateMatrixWorld();
    const out = (v: THREE.Vector3) => (v.x - 1) * angled.inward[0] + (v.z + 1.5) * angled.inward[1];
    expect(out(o.localToWorld(new THREE.Vector3(0.2, 0, 0)))).toBeCloseTo(0);
    expect(out(o.localToWorld(new THREE.Vector3(-0.2, 0, 0.03)))).toBeCloseTo(0.03);
  });

  it("stand free as partitions, a face each side, seen from the side the camera is on", () => {
    const [a, b] = wallsAlong([0, -1], [0, 1], 2, 10);
    expect([a.index, b.index]).toEqual([10, 11]);
    expect(a.inward[0] * b.inward[0]).toBeLessThan(0);
    const left = new THREE.Vector3(-3, 1, 0);
    expect([facesWall(a, left), facesWall(b, left)].filter(Boolean)).toHaveLength(1);
    // Seen from the left, the left face is hit in its middle.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(-3, 1, 0);
    camera.lookAt(0, 1, 0);
    const hit = wallPoint(camera, 50, 50, 100, 100, [a, b]);
    expect(hit?.wall.inward[0]).toBe(-1);
    expect(hit?.point.x).toBeCloseTo(0);
    // Hung there with its back on the partition, on the left side.
    const p = hangOn(hit?.wall ?? a, hit?.point ?? new THREE.Vector3(), [0, 0], frame) as number[];
    const box = boxOf(p, (hit?.wall ?? a).turn);
    expect(box.max.x).toBeCloseTo(0);
    expect(box.min.x).toBeCloseTo(-0.03);
  });
});

describe("gridNear", () => {
  it("lists a grid's points nearest a point first, on the step's multiples", () => {
    const points = gridNear([-1, -1, 1, 1], [0.5, 0.5], 0.5);
    expect(points).toHaveLength(25);
    expect(points[0]).toEqual([0.5, 0.5]);
    expect(points.at(-1)).toEqual([-1, -1]);
    for (const [x, z] of points) expect([Math.abs(x % 0.5), Math.abs(z % 0.5)]).toEqual([0, 0]);
    // With bounds off the grid lines, only the points inside are returned.
    expect(gridNear([0.1, 0.1, 0.9, 0.4], [0, 0], 0.25).sort()).toEqual([
      [0.25, 0.25],
      [0.5, 0.25],
      [0.75, 0.25],
    ]);
  });

  it("widens the step on a big area, and gives nothing for an empty one", () => {
    const points = gridNear([-50, -50, 50, 50], [0, 0], 0.1, 1000);
    expect(points.length).toBeLessThan(1300);
    expect(points[0]).toEqual([0, 0]);
    // The spacing widens by whole steps, so points stay on the snap grid.
    for (const [x, z] of points.slice(0, 50))
      expect([x, z].map((v) => Math.abs(Math.round(v / 0.1) * 0.1 - v) < 1e-9)).toEqual([true, true]);
    expect(gridNear([1, 0, 0, 1], [0, 0], 0.1)).toEqual([]);
  });

  it("gives the same points one at a time, nearest first, making only those asked for", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let n = 0; n < 200; n++) {
      const x = random() * 20 - 10;
      const z = random() * 20 - 10;
      const area = [x, z, x + random() * 8, z + random() * 8] as const;
      // Inside the area or well outside it.
      const near: [number, number] = [random() * 30 - 15, random() * 30 - 15];
      const step = [0.1, 0.25, 0.5][n % 3] as number;
      const limit = [4000, 100][n % 2] as number;
      const points = [...gridNearEach(area, near, step, limit)];
      expect(points).toEqual(gridNear(area, near, step, limit));
      const away = ([px, pz]: [number, number]) => (px - near[0]) ** 2 + (pz - near[1]) ** 2;
      for (let i = 1; i < points.length; i++)
        expect(away(points[i] as [number, number])).toBeGreaterThanOrEqual(
          away(points[i - 1] as [number, number]) - 1e-9,
        );
      // Every point of the grid once, all inside.
      expect(new Set(points.map((p) => p.join())).size).toBe(points.length);
      for (const [px, pz] of points) {
        expect(px).toBeGreaterThanOrEqual(area[0] - 1e-9);
        expect(pz).toBeLessThanOrEqual(area[3] + 1e-9);
      }
    }
    // The first point is found without generating the rest.
    const first = gridNearEach([-50, -50, 50, 50], [3, 3], 0.1).next().value;
    expect(first).toEqual(gridNear([-50, -50, 50, 50], [3, 3], 0.1)[0]);
  });
});
