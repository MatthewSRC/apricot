import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { InstanceSet } from "../instances";
import { SceneShadows, SHADOW_ONLY_LAYER, setShadow, shadowOf } from "../shadows";

const material = () => new THREE.MeshStandardNodeMaterial();

/** A floor, a box and a sun, the camera looking down at them. */
const setup = (options = {}) => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material());
  floor.rotation.x = -Math.PI / 2;
  const box = new THREE.Mesh(new THREE.BoxGeometry(), material());
  box.position.set(0, 0.5, 0);
  const sun = new THREE.DirectionalLight("#fff", 2);
  sun.position.set(3, 6, 4);
  const fill = new THREE.DirectionalLight("#fff", 0.5);
  scene.add(floor, box, sun, fill);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 8, 8);
  camera.lookAt(0, 0, 0);
  const shadows = new SceneShadows(scene, options);
  return { scene, floor, box, sun, fill, camera, shadows };
};

describe("SceneShadows", () => {
  it("lets the brightest directional light cast, set up to redraw only on demand", () => {
    const { sun, fill, camera, shadows } = setup({ size: 512, softness: 3, darkness: 0.6 });
    shadows.update(camera);
    expect(shadows.casting).toEqual([sun]);
    expect(sun.castShadow).toBe(true);
    expect(fill.castShadow).toBe(false);
    expect(sun.shadow.autoUpdate).toBe(false);
    expect(sun.shadow.mapSize.x).toBe(512);
    expect(sun.shadow.radius).toBe(3);
    expect(sun.shadow.intensity).toBe(0.6);
    // A light marked to cast takes over; one marked not to never casts.
    setShadow(fill, { cast: true });
    shadows.update(camera);
    expect(shadows.casting).toEqual([fill]);
    expect(sun.castShadow).toBe(false);
    setShadow(fill, undefined);
    setShadow(sun, { cast: false });
    shadows.update(camera);
    expect(shadows.casting).toEqual([fill]);
  });

  it("decides who casts and receives: floors only receive, see-through things neither, choices win", () => {
    const { floor, box, camera, shadows } = setup();
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalNodeMaterial({ transmission: 1 }),
    );
    const faded = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.4 }),
    );
    const thin = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material());
    thin.scale.set(10, 0.01, 10);
    box.parent?.add(glass, faded, thin);
    shadows.update(camera);
    expect([floor.castShadow, floor.receiveShadow]).toEqual([false, true]);
    expect([box.castShadow, box.receiveShadow]).toEqual([true, true]);
    expect([glass.castShadow, glass.receiveShadow]).toEqual([false, false]);
    expect(shadowOf(faded)).toEqual({ cast: false, receive: false });
    expect(thin.castShadow).toBe(false);
    setShadow(floor, { cast: true });
    setShadow(box, { receive: false });
    shadows.update(camera);
    expect(floor.castShadow).toBe(true);
    expect([box.castShadow, box.receiveShadow]).toEqual([true, false]);
  });

  it("redraws when something that casts moves, or the light turns, not when the camera moves", () => {
    const { box, sun, camera, shadows, scene } = setup();
    expect(shadows.update(camera)).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);
    sun.shadow.needsUpdate = false;
    expect(shadows.update(camera)).toBe(false);
    camera.position.set(-8, 4, 2);
    camera.lookAt(0, 0, 0);
    expect(shadows.update(camera)).toBe(false);
    box.position.x = 1;
    expect(shadows.update(camera)).toBe(true);
    sun.position.set(-3, 6, 4);
    expect(shadows.update(camera)).toBe(true);
    // Copies moving, and a new caster, count too.
    const set = new InstanceSet([
      { geometry: new THREE.BoxGeometry(), material: material(), offset: new THREE.Matrix4() },
    ]);
    set.setItems([{ position: [2, 0.5, 0] }]);
    scene.add(set.group);
    expect(shadows.update(camera)).toBe(true);
    expect(shadows.update(camera)).toBe(false);
    set.set(0, { position: [3, 0.5, 0] });
    expect(shadows.update(camera)).toBe(true);
    box.visible = false;
    expect(shadows.update(camera)).toBe(true);
    expect(shadows.redraws).toBe(6);
  });

  it("fits the shadow to what casts, or to `radius` around what the camera looks at", () => {
    const fitted = setup();
    fitted.shadows.update(fitted.camera);
    const c = fitted.sun.shadow.camera as THREE.OrthographicCamera;
    // About the box (1 m), not the 20 m floor, which does not cast.
    expect(c.right - c.left).toBeLessThan(3);
    expect(c.far).toBeGreaterThan(c.near);
    expect(fitted.sun.shadow.normalBias).toBeGreaterThan(0);

    const near = setup({ radius: 5, size: 1000 });
    near.shadows.update(near.camera);
    const n = near.sun.shadow.camera as THREE.OrthographicCamera;
    expect(n.right - n.left).toBeCloseTo(10);
    // The camera turning round the same point keeps the area; looking elsewhere moves it (whole texels).
    near.sun.shadow.needsUpdate = false;
    near.camera.position.set(8, 8, 0);
    near.camera.lookAt(0, 0, 0);
    expect(near.shadows.update(near.camera)).toBe(false);
    near.camera.lookAt(6, 0, 0);
    expect(near.shadows.update(near.camera)).toBe(true);
    const texel = 10 / 1000;
    expect(Math.abs(n.left / texel - Math.round(n.left / texel))).toBeLessThan(1e-6);
    // Looking up at the sky: an area ahead of the camera.
    near.camera.lookAt(0, 20, -20);
    near.shadows.update(near.camera);
    expect(n.right - n.left).toBeCloseTo(10);
  });

  it("does nothing without a directional light or anything that casts", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const shadows = new SceneShadows(scene);
    expect(shadows.update(camera)).toBe(false);
    scene.add(new THREE.DirectionalLight());
    expect(shadows.update(camera)).toBe(false);
  });

  it("centres a radius area on the camera's focus, so circling a still subject never redraws", () => {
    const { camera, shadows, box } = setup({ radius: 5 });
    const focus = new THREE.Vector3(0, 0.5, 0);
    shadows.update(camera, focus);
    for (let a = 0; a < 6; a++) {
      // A camera drifting round, its line of sight meeting the ground somewhere else each time.
      camera.position.set(Math.sin(a) * 8, 3, Math.cos(a) * 8);
      camera.lookAt(0, 4, 0);
      expect(shadows.update(camera, focus)).toBe(false);
    }
    box.position.x = 0.2;
    expect(shadows.update(camera, focus)).toBe(true);
  });

  it("ignores casters moving outside the area, but redraws when one comes in or leaves", () => {
    const { scene, camera, shadows } = setup({ radius: 5 });
    const focus = new THREE.Vector3(0, 0.5, 0);
    const train = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 4), material());
    train.position.set(60, 0.5, 0);
    scene.add(train);
    expect(shadows.update(camera, focus)).toBe(true);
    // Far away: its moves do not touch this shadow.
    for (let x = 58; x > 30; x -= 2) {
      train.position.x = x;
      expect(shadows.update(camera, focus)).toBe(false);
    }
    // Coming in.
    train.position.x = 1;
    expect(shadows.update(camera, focus)).toBe(true);
    train.position.x = 1.5;
    expect(shadows.update(camera, focus)).toBe(true);
    // Leaving: one more redraw to clear where it was, then nothing.
    train.position.x = 40;
    expect(shadows.update(camera, focus)).toBe(true);
    train.position.x = 45;
    expect(shadows.update(camera, focus)).toBe(false);
  });

  it("keeps working with copies that have none yet (an empty pile), and fits them once they come", () => {
    const { scene, sun, camera, shadows } = setup();
    // A pile before its first fruit: an instanced mesh with no copies.
    const pile = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2), material(), 10);
    pile.count = 0;
    scene.add(pile);
    shadows.update(camera);
    const shadow = sun.shadow.camera as THREE.OrthographicCamera;
    expect(Number.isFinite(shadow.near)).toBe(true);
    expect(Number.isFinite(shadow.far)).toBe(true);
    // Still: no redraw.
    expect(shadows.update(camera)).toBe(false);
    // Copies come, high above the box: the area grows to hold them.
    const far = shadow.far;
    pile.count = 1;
    pile.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 30, 0));
    pile.instanceMatrix.needsUpdate = true;
    pile.boundingBox = null;
    expect(shadows.update(camera)).toBe(true);
    expect(Number.isFinite(shadow.near) && Number.isFinite(shadow.far)).toBe(true);
    expect(shadow.far - shadow.near).toBeGreaterThan(far - 0);
  });

  it("with two lights casting, redraws only when something changes, not every frame", () => {
    const { box, sun, fill, camera, shadows } = setup();
    fill.position.set(-4, 5, 2);
    setShadow(sun, { cast: true });
    setShadow(fill, { cast: true });
    shadows.update(camera);
    expect(shadows.casting).toEqual([sun, fill]);
    // Each light has its own area: neither one's fit undoes the other's.
    expect(shadows.update(camera)).toBe(false);
    expect(shadows.update(camera)).toBe(false);
    expect((sun.shadow.camera as THREE.OrthographicCamera).left).not.toBe(
      (fill.shadow.camera as THREE.OrthographicCamera).left,
    );
    box.position.x += 0.5;
    expect(shadows.update(camera)).toBe(true);
    expect(shadows.update(camera)).toBe(false);
  });
  it("casts the shadow of shadow-only things, which no camera draws", () => {
    const { scene, box, sun, camera, shadows } = setup();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4), material());
    roof.position.y = 3;
    scene.add(roof);
    setShadow(roof, { only: true });
    expect(roof.layers.test(camera.layers)).toBe(false);
    expect(roof.layers.mask).toBe(2 ** SHADOW_ONLY_LAYER);
    expect(shadowOf(roof)).toEqual({ cast: true, receive: false });
    shadows.update(camera);
    expect(roof.castShadow).toBe(true);
    // The light that casts sees it; cameras don't.
    expect(roof.layers.test(sun.shadow.camera.layers)).toBe(true);
    expect(box.layers.test(sun.shadow.camera.layers)).toBe(true);
    // Drawn again once it is not shadow-only.
    setShadow(roof, undefined);
    expect(roof.layers.test(camera.layers)).toBe(true);
  });

  it("blurs shadows on request, with enough taps for the softness", () => {
    const { sun, camera, shadows } = setup({ blur: true, softness: 8 });
    expect(shadows.type).toBe(THREE.VSMShadowMap);
    shadows.update(camera);
    expect(sun.shadow.radius).toBe(8);
    expect(sun.shadow.blurSamples).toBe(16);
    expect(shadows.describe()).toMatchObject({ blur: true });
    expect(setup().shadows.type).toBe(THREE.PCFShadowMap);
  });
  it("pauses what moves for a while: redrawn when it stops casting and when it casts again, not as it moves", () => {
    const { scene, box, sun, camera, shadows } = setup();
    const held = new THREE.Group();
    const chair = new THREE.Mesh(new THREE.BoxGeometry(), material());
    held.add(chair);
    held.position.set(1, 0.5, 0);
    scene.add(held);
    shadows.update(camera);
    expect(chair.castShadow).toBe(true);
    // Picked up: it stops casting, which redraws once.
    const resume = shadows.pause(held);
    const again = shadows.pause(held);
    expect(shadows.update(camera)).toBe(true);
    expect(chair.castShadow).toBe(false);
    expect(box.castShadow).toBe(true);
    expect(shadows.describe().casters).toBe(1);
    // Dragged about: no redraws.
    for (let i = 0; i < 5; i++) {
      held.position.x += 0.3;
      expect(shadows.update(camera)).toBe(false);
    }
    // Still paused once more; then put down: it casts again where it is.
    resume();
    resume();
    expect(shadows.update(camera)).toBe(false);
    again();
    expect(shadows.update(camera)).toBe(true);
    expect(chair.castShadow).toBe(true);
    // One caster swapped for another (same count): still redrawn.
    const stop = shadows.pause(box);
    const other = shadows.pause(held);
    other();
    shadows.update(camera);
    const swap = shadows.pause(held);
    stop();
    expect(shadows.update(camera)).toBe(true);
    swap();
    // The light's own view draws bundles one by one: its casters come and go.
    expect(sun.shadow.camera.userData["apricot:skipBundles"]).toBe(true);
  });

  it("refits the shadow area only when something that casts moved", () => {
    const { box, camera, shadows } = setup();
    shadows.update(camera);
    const fit = vi.spyOn(shadows as unknown as { fit: () => boolean }, "fit");
    shadows.update(camera);
    shadows.update(camera);
    expect(fit).not.toHaveBeenCalled();
    box.position.x = 1;
    shadows.update(camera);
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
