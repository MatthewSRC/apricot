import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CAMERA_VIEWS, CameraRig } from "../rig";

const camera = (aspect = 1) => new THREE.PerspectiveCamera(50, aspect, 0.1, 100);

/** A car-sized box: 1.8 wide, 1.3 tall, 4.6 long, sitting on the ground. */
const car = () => new THREE.Box3(new THREE.Vector3(-0.9, 0, -2.3), new THREE.Vector3(0.9, 1.3, 2.3));

/** Every corner of `box` projects inside the view, within `limit` of the centre (NDC). */
const fits = (cam: THREE.PerspectiveCamera, box: THREE.Box3, limit = 1) => {
  cam.updateMatrixWorld();
  let extent = 0;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).project(cam);
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  }
  return extent <= limit && extent > limit * 0.75;
};

describe("CameraRig", () => {
  it("frames the subject snugly from every built-in view", () => {
    const cam = camera(0.5);
    const rig = new CameraRig(cam);
    rig.setViewport(400, 800);
    rig.setSubject(car());
    for (const name of Object.keys(CAMERA_VIEWS)) {
      rig.jumpTo(name);
      expect(fits(cam, car()), name).toBe(true);
    }
  });

  it("frames a new subject afresh, flying there or cutting, wherever a finger left the camera", () => {
    const cam = camera(0.5);
    const rig = new CameraRig(cam);
    rig.setViewport(400, 800);
    rig.setOrbit({});
    rig.setSubject(car());
    rig.jumpTo("three-quarter");
    // After a manual zoom, setting the same subject again leaves the camera where it is.
    rig.zoom(1.5);
    const away = () => cam.position.distanceTo(new THREE.Vector3(0, 0.65, 0));
    const zoomed = away();
    rig.setSubject(car());
    expect(away()).toBeCloseTo(zoomed);
    // A new subject with a transition flies to its own framing.
    const mug = new THREE.Box3(new THREE.Vector3(-0.05, 0, -0.05), new THREE.Vector3(0.05, 0.1, 0.05));
    rig.setSubject(mug, { transition: 0.5 });
    expect(away()).toBeCloseTo(zoomed);
    rig.update(0.25);
    expect(away()).toBeLessThan(zoomed);
    rig.update(0.3);
    expect(fits(cam, mug)).toBe(true);
    // A zero transition cuts straight to the new framing.
    rig.setSubject(car(), { transition: 0 });
    expect(fits(cam, car())).toBe(true);
  });

  it("puts the camera where the view says", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.jumpTo({ azimuth: 90, elevation: 0, distance: 5, target: [0, 1, 0] });
    expect(cam.position.x).toBeCloseTo(5);
    expect(cam.position.y).toBeCloseTo(1);
    rig.jumpTo("top");
    // A view without a target keeps the current target ([0, 1, 0]) and uses the default distance.
    expect(cam.position.y).toBeCloseTo(7, 2);
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeLessThan(0.05);
    rig.jumpTo({ position: [0, 3, 4], fov: 30 });
    expect(cam.position.toArray().map((v) => +v.toFixed(5))).toEqual([0, 3, 4]);
    expect(cam.fov).toBe(30);
  });

  it("flies on an arc, the short way round, and lands on the view", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.jumpTo({ azimuth: 170, elevation: 0, distance: 4 });
    rig.flyTo({ azimuth: -170, elevation: 0, distance: 4 }, 1);
    expect(rig.moving).toBe(true);
    expect(rig.update(0.5)).toBe(true);
    // Halfway through, the camera is behind the target (azimuth 180) and still 4 away, so it moved on an arc.
    expect(cam.position.z).toBeCloseTo(-4, 3);
    expect(cam.position.length()).toBeCloseTo(4, 5);
    expect(rig.update(0.6)).toBe(false);
    expect(rig.moving).toBe(false);
    expect(rig.update(0.1)).toBe(false);
    expect(cam.position.x).toBeCloseTo(-4 * Math.sin((10 * Math.PI) / 180), 5);
    // A zero-length flight jumps.
    rig.flyTo("front", 0);
    expect(rig.moving).toBe(false);
  });

  it("frames the subject in the part of the screen not covered by UI", () => {
    const cam = camera(0.5);
    const rig = new CameraRig(cam, { margin: 0 });
    rig.setViewport(400, 800, { bottom: 400 });
    rig.setSubject(car());
    rig.jumpTo("front");
    // The subject's centre is drawn in the middle of the top half.
    const centre = car().getCenter(new THREE.Vector3()).project(cam);
    expect(centre.y).toBeCloseTo(0.5, 2);
    expect(fits(cam, car())).toBe(true);
    // Without an inset, the view offset is cleared.
    rig.setViewport(400, 800);
    expect(cam.view?.enabled ?? false).toBe(false);
  });

  it("re-aims a flight when the subject arrives mid-way", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.flyTo("left", 1);
    rig.update(0.5);
    rig.setSubject(new THREE.Box3(new THREE.Vector3(9, 0, 0), new THREE.Vector3(11, 2, 2)));
    rig.update(1);
    const target = new THREE.Vector3(10, 1, 1);
    expect(
      cam.getWorldDirection(new THREE.Vector3()).dot(target.clone().sub(cam.position).normalize()),
    ).toBeCloseTo(1, 4);
    rig.setSubject(new THREE.Box3());
  });

  it("knows custom views and lists every name when given an unknown one", () => {
    const rig = new CameraRig(camera(), { views: { hero: { azimuth: 20, elevation: 5, distance: 3 } } });
    expect(rig.resolve("hero").distance).toBe(3);
    expect(() => rig.resolve("bottom")).toThrow(/Unknown camera view "bottom".*front.*hero/);
    expect(() => new CameraRig(camera()).resolve("x")).toThrow(/three-quarter$/);
  });

  it("follows a moving object, easing after it, keeping the view's angle", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.setViewport(400, 400);
    const train = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10));
    train.position.set(0, 1, 0);
    rig.setSubject(new THREE.Box3().setFromObject(train));
    rig.follow(train, 4);
    rig.jumpTo({ azimuth: 90, elevation: 0, distance: 20 });
    expect(cam.position.toArray().map((v) => Math.round(v))).toEqual([20, 1, 0]);
    train.position.z = 50;
    expect(rig.update(0.1)).toBe(true);
    const partWay = cam.position.z;
    expect(partWay).toBeGreaterThan(0);
    expect(partWay).toBeLessThan(50);
    for (let i = 0; i < 100; i++) rig.update(0.1);
    expect(cam.position.z).toBeCloseTo(50, 2);
    expect(cam.position.x).toBeCloseTo(20, 2);
    // Once caught up and still, update reports no movement.
    expect(rig.update(0.1)).toBe(false);
    // Flights keep following.
    rig.flyTo({ azimuth: 0, elevation: 0, distance: 20 }, 1);
    train.position.z = 60;
    for (let i = 0; i < 40; i++) rig.update(0.1);
    expect(cam.position.z).toBeCloseTo(80, 1);
    rig.follow(null);
    train.position.z = 0;
    expect(rig.update(0.1)).toBe(false);
  });

  it("follows objects without a subject box, aiming at their origin", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    const runner = new THREE.Object3D();
    runner.position.set(5, 0, 0);
    rig.follow(runner);
    rig.jumpTo({ azimuth: 0, elevation: 0, distance: 10 });
    expect(cam.position.x).toBeCloseTo(5);
  });

  it("drifts slowly around the subject between flights", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.jumpTo({ azimuth: 0, elevation: 0, distance: 10 });
    rig.drift = 90;
    expect(rig.update(1)).toBe(true);
    expect(cam.position.x).toBeCloseTo(10, 3);
    rig.flyTo({ azimuth: 0, elevation: 0, distance: 10 }, 1);
    rig.update(0.5);
    expect(rig.moving).toBe(true);
  });

  it("widens the camera's range for far views, never narrowing it", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.jumpTo({ azimuth: 0, elevation: 90, distance: 1000 });
    expect(cam.far).toBe(5000);
    expect(cam.near).toBe(1);
    rig.jumpTo({ azimuth: 0, elevation: 0, distance: 5 });
    expect(cam.far).toBe(100);
    expect(cam.near).toBe(0.1);
  });

  it("stops following without jumping, and eases onto an object it starts following", () => {
    const cam = camera();
    const rig = new CameraRig(cam);
    rig.setViewport(400, 800);
    const train = new THREE.Object3D();
    train.position.set(100, 0, 50);
    rig.follow(train);
    rig.jumpTo({ azimuth: 55, elevation: 26, distance: 20 });
    const aim = () => {
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      // Where the line of sight meets the ground.
      return cam.position.clone().addScaledVector(forward, -cam.position.y / forward.y);
    };
    expect(aim().distanceTo(train.position)).toBeLessThan(1);
    // When following stops and the subject is cleared, the camera stays put.
    const before = cam.position.clone();
    rig.follow(null);
    rig.setSubject(null);
    expect(cam.position.distanceTo(before)).toBeLessThan(1e-6);
    // It then flies to the map, starting from the train.
    rig.flyTo({ azimuth: 0, elevation: 90, distance: 300, target: [0, 0, 0] }, 1);
    rig.update(0.05);
    expect(aim().distanceTo(train.position)).toBeLessThan(5);
    for (let i = 0; i < 30; i++) rig.update(1 / 30);
    expect(aim().length()).toBeLessThan(1);
    // When following resumes, the aim moves gradually from the map's centre to the train.
    rig.follow(train);
    rig.flyTo({ azimuth: 55, elevation: 26, distance: 20 }, 1);
    rig.update(0.1);
    const early = aim();
    expect(early.distanceTo(train.position)).toBeGreaterThan(50);
    for (let i = 0; i < 4; i++) rig.update(0.1);
    const midway = aim();
    expect(midway.distanceTo(train.position)).toBeLessThan(early.distanceTo(train.position));
    expect(midway.length()).toBeGreaterThan(5);
    for (let i = 0; i < 10; i++) rig.update(0.1);
    expect(aim().distanceTo(train.position)).toBeLessThan(1);
  });
});
