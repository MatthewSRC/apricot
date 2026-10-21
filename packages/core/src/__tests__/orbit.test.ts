import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CameraRig, fitBoxDistance, type OrbitOptions } from "../rig";

const DEG = 180 / Math.PI;

/** A rig on a 400 × 800 canvas looking at the origin from the front, 10 away, 20° up. */
const setup = (orbit: OrbitOptions | null = {}) => {
  let now = 0;
  const camera = new THREE.PerspectiveCamera(50, 0.5, 0.1, 100);
  const rig = new CameraRig(camera, { now: () => now });
  rig.setViewport(400, 800);
  rig.jumpTo({ azimuth: 0, elevation: 20, distance: 10, target: [0, 0, 0] });
  rig.setOrbit(orbit);
  // The camera's position as an orbit around the origin.
  const pose = () => {
    const p = camera.position;
    const distance = p.length();
    return {
      azimuth: Math.atan2(p.x, p.z) * DEG,
      elevation: Math.asin(p.y / distance) * DEG,
      distance,
    };
  };
  return { rig, camera, pose, clock: (ms: number) => (now = ms) };
};

describe("CameraRig orbit", () => {
  it("turns with one finger: right turns the subject right, down looks from higher up", () => {
    const { rig, pose } = setup();
    expect(rig.touch([{ x: 200, y: 400 }], 0)).toBe(false);
    expect(rig.touching).toBe(true);
    // 100 points is a quarter of the width, which turns 45°.
    expect(rig.touch([{ x: 300, y: 400 }], 16)).toBe(true);
    expect(pose().azimuth).toBeCloseTo(-45);
    rig.touch([{ x: 300, y: 440 }], 32);
    expect(pose().elevation).toBeCloseTo(38);
    expect(pose().distance).toBeCloseTo(10);
    // A finger that stops before lifting does not flick.
    expect(rig.release(500)).toBeCloseTo(140);
    expect(rig.touching).toBe(false);
    expect(rig.update(0.1)).toBe(false);
  });

  it("pinches to zoom within limits, and a wheel zooms too", () => {
    const { rig, pose } = setup({ zoom: [0.5, 2] });
    rig.touch(
      [
        { x: 150, y: 400 },
        { x: 250, y: 400 },
      ],
      0,
    );
    // Fingers twice as far apart halve the distance.
    rig.touch(
      [
        { x: 100, y: 400 },
        { x: 300, y: 400 },
      ],
      16,
    );
    expect(pose().distance).toBeCloseTo(5);
    // Zoom stops at half the view's distance.
    rig.touch(
      [
        { x: 0, y: 400 },
        { x: 400, y: 400 },
      ],
      32,
    );
    expect(pose().distance).toBeCloseTo(5);
    // Lifting one finger does not jump, and the remaining finger turns from there.
    rig.touch([{ x: 0, y: 400 }], 48);
    expect(pose().azimuth).toBeCloseTo(0);
    rig.release(60);
    expect(rig.zoom(10)).toBe(true);
    expect(pose().distance).toBeCloseTo(20);
    expect(rig.zoom(2)).toBe(false);
    const fixed = setup({ zoom: false });
    expect(fixed.rig.zoom(2)).toBe(false);
    fixed.rig.touch(
      [
        { x: 150, y: 400 },
        { x: 250, y: 400 },
      ],
      0,
    );
    expect(
      fixed.rig.touch(
        [
          { x: 100, y: 400 },
          { x: 300, y: 400 },
        ],
        16,
      ),
    ).toBe(false);
  });

  it("keeps within the turn and elevation limits, without snapping a view already outside them", () => {
    const { rig, pose } = setup({ turn: 30, elevation: [0, 60] });
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 400, y: 0 }], 16);
    expect(pose().azimuth).toBeCloseTo(-30);
    expect(pose().elevation).toBeCloseTo(0);
    rig.release(500);
    // A top view (90°) is above the limit. Dragging may lower it but not raise it, and it does not jump.
    rig.jumpTo({ azimuth: 0, elevation: 89, distance: 10, target: [0, 0, 0] });
    rig.touch([{ x: 200, y: 400 }], 1000);
    rig.touch([{ x: 200, y: 420 }], 1016);
    expect(pose().elevation).toBeCloseTo(89, 0);
    rig.touch([{ x: 200, y: 380 }], 1032);
    expect(pose().elevation).toBeCloseTo(71, 0);
  });

  it("keeps turning after a flick, slowing down, unless inertia is off", () => {
    const { rig, pose } = setup();
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 220, y: 400 }], 16);
    rig.release(20);
    const lifted = pose().azimuth;
    // A zero-length frame, as when the loop wakes, keeps the flick going.
    expect(rig.update(0)).toBe(true);
    expect(rig.update(1 / 60)).toBe(true);
    const step = pose().azimuth - lifted;
    expect(step).toBeLessThan(0);
    let frames = 0;
    while (rig.update(1 / 60) && frames < 600) frames++;
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(600);
    // A new touch stops the flick.
    const still = setup({ inertia: false });
    still.rig.touch([{ x: 200, y: 400 }], 0);
    still.rig.touch([{ x: 220, y: 400 }], 16);
    still.rig.release(20);
    expect(still.rig.update(1 / 60)).toBe(false);
  });

  it("a touch stops a flight where it is; drift pauses while touching", () => {
    const { rig, pose } = setup();
    rig.flyTo({ azimuth: 90, elevation: 20, distance: 10, target: [0, 0, 0] }, 1);
    rig.update(0.5);
    const midway = pose().azimuth;
    expect(midway).toBeGreaterThan(10);
    rig.touch([{ x: 200, y: 400 }], 0);
    expect(rig.moving).toBe(false);
    rig.drift = 10;
    rig.update(1);
    expect(pose().azimuth).toBeCloseTo(midway);
    rig.release(100);
    rig.update(1);
    expect(pose().azimuth).toBeCloseTo(midway + 10);
    // A new view flight cancels a flick.
    rig.touch([{ x: 200, y: 400 }], 200);
    rig.touch([{ x: 260, y: 400 }], 216);
    rig.release(220);
    rig.drift = 0;
    rig.flyTo({ azimuth: 0, elevation: 20, distance: 10, target: [0, 0, 0] }, 0.5);
    for (let i = 0; i < 40; i++) rig.update(1 / 60);
    expect(pose().azimuth).toBeCloseTo(0);
  });

  it("flies back to the view after `returnAfter` seconds at rest", () => {
    const { rig, pose, clock } = setup({ returnAfter: 2, inertia: false });
    expect(rig.returnsIn).toBeNull();
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 300, y: 400 }], 16);
    clock(1000);
    rig.release(500);
    expect(rig.returnsIn).toBe(2000);
    clock(2500);
    expect(rig.update(0.1)).toBe(false);
    expect(rig.returnsIn).toBe(500);
    clock(3000);
    expect(rig.update(0.1)).toBe(true);
    for (let i = 0; i < 60; i++) rig.update(1 / 60);
    expect(pose().azimuth).toBeCloseTo(0);
    expect(rig.returnsIn).toBeNull();
  });

  it("ignores touches when off, and turning it off forgets a gesture", () => {
    const { rig, pose } = setup(null);
    expect(rig.touch([{ x: 200, y: 400 }], 0)).toBe(false);
    expect(rig.touch([], 0)).toBe(false);
    expect(rig.release(10)).toBe(0);
    expect(rig.zoom(2)).toBe(false);
    rig.setOrbit({});
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.setOrbit(null);
    expect(rig.touching).toBe(false);
    expect(pose().azimuth).toBeCloseTo(0);
  });

  it("keeps a hand-turned view when following stops or starts, so the next flight starts from it", () => {
    const { rig, camera, pose } = setup();
    const train = new THREE.Object3D();
    train.position.set(40, 0, -10);
    // Following with drift, then turned by hand.
    rig.follow(train);
    rig.jumpTo({ azimuth: 55, elevation: 26, distance: 20 });
    rig.drift = 2;
    rig.update(0.5);
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 280, y: 400 }], 16);
    rig.release(400);
    const turned = camera.position.clone();
    // Switching to the map: following stops, the subject is cleared (as <CameraRig> does), then the camera flies.
    rig.drift = 0;
    rig.follow(null);
    rig.setSubject(null);
    rig.setViewport(400, 800);
    expect(camera.position.distanceTo(turned)).toBeLessThan(1e-6);
    rig.flyTo({ azimuth: 0, elevation: 89, distance: 300, target: [0, 0, 0] }, 1);
    rig.update(0.02);
    expect(camera.position.distanceTo(turned)).toBeLessThan(3);
    for (let i = 0; i < 60; i++) rig.update(1 / 30);
    // Turned by hand on the map, then back to the train. Following starts without a jump.
    rig.touch([{ x: 200, y: 400 }], 1000);
    rig.touch([{ x: 200, y: 360 }], 1016);
    rig.release(1400);
    const onMap = camera.position.clone();
    rig.setSubject(new THREE.Box3().setFromCenterAndSize(train.position, new THREE.Vector3(3, 3, 20)));
    rig.follow(train);
    expect(camera.position.distanceTo(onMap)).toBeLessThan(1e-6);
    rig.flyTo({ azimuth: 55, elevation: 26, distance: 20 }, 1);
    rig.update(0.02);
    expect(camera.position.distanceTo(onMap)).toBeLessThan(15);
    for (let i = 0; i < 40; i++) rig.update(1 / 30);
    expect(pose().azimuth).toBeDefined();
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const aim = camera.position.clone().addScaledVector(forward, -camera.position.y / forward.y);
    expect(aim.distanceTo(train.position)).toBeLessThan(0.5);
  });
});

describe("CameraRig sway, fixed limits, fits and kept distances", () => {
  it("sways back and forth round the view, holds while a finger turns it, and swings on from there", () => {
    const { rig, pose } = setup();
    rig.jumpTo({ azimuth: -30, elevation: 20, distance: 10 });
    rig.sway = { degrees: 10, period: 4 };
    const seen: number[] = [];
    // After easing in and one full swing, the azimuth stays between -40 and -20.
    for (let i = 0; i < 300; i++) {
      expect(rig.update(1 / 60)).toBe(true);
      if (i >= 60) seen.push(pose().azimuth);
    }
    expect(Math.min(...seen)).toBeCloseTo(-40, 0);
    expect(Math.max(...seen)).toBeCloseTo(-20, 0);
    // Setting an equal sway again, as on a component re-render, changes nothing.
    const before = pose().azimuth;
    rig.sway = { degrees: 10, period: 4 };
    rig.update(1 / 60);
    expect(Math.abs(pose().azimuth - before)).toBeLessThan(1);
    // While a finger turns the camera, it follows the finger and does not swing.
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 260, y: 400 }], 16);
    const turned = pose().azimuth;
    rig.update(1 / 60);
    expect(pose().azimuth).toBeCloseTo(turned);
    rig.release(500);
    // Afterwards it eases back into the swing without a jump.
    let last = pose().azimuth;
    for (let i = 0; i < 240; i++) {
      rig.update(1 / 60);
      expect(Math.abs(pose().azimuth - last)).toBeLessThan(2);
      last = pose().azimuth;
    }
    expect(last).toBeGreaterThanOrEqual(-41);
    expect(last).toBeLessThanOrEqual(-19);
    rig.sway = null;
    expect(rig.update(1 / 60)).toBe(false);
  });

  it("keeps fixed orbit limits whatever the view", () => {
    const { rig, pose } = setup({ azimuth: [-76, 4] });
    rig.jumpTo({ azimuth: -30, elevation: 20, distance: 10 });
    // Dragging far to the left stops at 4°.
    rig.touch([{ x: 200, y: 400 }], 0);
    rig.touch([{ x: 0, y: 400 }], 16);
    rig.touch([{ x: -2000, y: 400 }], 32);
    rig.release(1000);
    expect(pose().azimuth).toBeCloseTo(4);
    // A new view does not move the fixed limits.
    rig.jumpTo({ azimuth: -60, elevation: 20, distance: 10 });
    rig.touch([{ x: 200, y: 400 }], 2000);
    rig.touch([{ x: 4000, y: 400 }], 2016);
    rig.release(3000);
    expect(pose().azimuth).toBeCloseTo(-76);
  });

  it("fits a room's floor plan or a box of its own, and keeps a distance between views", () => {
    // On a wide canvas, the room's walls make it frame smaller than the island.
    const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
    const rig = new CameraRig(camera);
    rig.setViewport(800, 400);
    // A room with tall walls and a flat island with the same floor size.
    const room = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2.7, 2));
    const island = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 0.3, 2));
    const distanceFor = (box: THREE.Box3) => {
      rig.setSubject(box);
      rig.jumpTo({ azimuth: -30, elevation: 30 });
      return camera.position.distanceTo(rig.target);
    };
    expect(distanceFor(room)).toBeGreaterThan(distanceFor(island) * 1.2);
    // Fitting their floor plans, looking at the floor's middle, gives the same scale.
    rig.fit = "footprint";
    expect(distanceFor(room)).toBeCloseTo(distanceFor(island), 5);
    expect(rig.target.y).toBeCloseTo(0);
    rig.fit = [4.2, 1, 4.2];
    expect(distanceFor(room)).toBeCloseTo(distanceFor(island), 5);
    // The kept distance is used from another side too.
    rig.fit = "box";
    rig.setSubject(room);
    rig.keepDistance = true;
    rig.jumpTo({ azimuth: 0, elevation: 30 });
    const front = camera.position.distanceTo(rig.target);
    rig.jumpTo({ azimuth: 45, elevation: 30 });
    expect(camera.position.distanceTo(rig.target)).toBeCloseTo(front, 5);
    // The floor plan of a given box, ignoring parts that reach past it.
    rig.keepDistance = false;
    const tile = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 0.3, 2));
    const overhanging = new THREE.Box3(new THREE.Vector3(-2.8, 0, -2), new THREE.Vector3(2.8, 3, 2));
    rig.fit = "footprint";
    const wider = distanceFor(overhanging);
    rig.fit = { footprint: tile };
    expect(distanceFor(overhanging)).toBeLessThan(wider);
    // This matches the tile's own floor plan.
    const byTile = distanceFor(overhanging);
    rig.fit = "footprint";
    expect(distanceFor(tile)).toBeCloseTo(byTile, 5);
    // fitBoxDistance gives the same distance the rig used.
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    expect(
      fitBoxDistance(box, { azimuth: 0, elevation: 0, fov: 40, width: 400, height: 800 }),
    ).toBeGreaterThan(0);
  });

  it("eases to new edges over a transition, and takes a new canvas size at once", () => {
    const camera = new THREE.PerspectiveCamera(40, 0.5, 0.1, 100);
    const rig = new CameraRig(camera);
    // A sheet covers most of the screen, leaving a short band above it for the subject.
    rig.setViewport(400, 800, { bottom: 600 });
    rig.setSubject(new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1)));
    rig.jumpTo({ azimuth: -30, elevation: 30 });
    const behindSheet = camera.position.distanceTo(rig.target);
    // As the sheet slides away, the inset eases and the subject grows without jumping.
    rig.setViewport(400, 800, {}, { transition: 1 });
    expect(camera.position.distanceTo(rig.target)).toBeCloseTo(behindSheet, 5);
    expect(rig.moving).toBe(true);
    expect(rig.update(0.3)).toBe(true);
    const easing = camera.position.distanceTo(rig.target);
    rig.update(0.8);
    const free = camera.position.distanceTo(rig.target);
    expect(rig.moving).toBe(false);
    expect(easing).toBeLessThan(behindSheet);
    expect(free).toBeLessThan(easing);
    // A new canvas size applies at once.
    rig.setViewport(400, 600, { bottom: 300 }, { transition: 1 });
    expect(rig.moving).toBe(false);
  });
});
