import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { FitCamera } from "../FitCamera";
import { fireLayout, renderScene } from "./render";

const onScreen = (camera: THREE.PerspectiveCamera, x: number, y: number) => {
  const ndc = new THREE.Vector3(x, y, 0).project(camera);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
};

describe("<FitCamera>", () => {
  it("frames the area now and again after the scene resizes", async () => {
    const view = await renderScene(<FitCamera size={[4, 2]} margin={0.05} />, {
      camera: { position: [0, 0, 1] },
    });
    const { camera } = view.scene;
    expect(onScreen(camera, 2, 1)).toBe(true);
    expect(onScreen(camera, -2, -1)).toBe(true);
    const wide = camera.position.z;
    // In portrait, fitting the width needs the camera farther away.
    await fireLayout(view.container, 100, 400);
    expect(camera.position.z).toBeGreaterThan(wide);
    expect(onScreen(camera, 2, 1)).toBe(true);
    view.update(<FitCamera size={[4, 2]} target={[1, 0, 0]} />);
    // The camera looks straight at the new target.
    const centre = new THREE.Vector3(1, 0, 0).project(camera);
    expect(Math.abs(centre.x)).toBeLessThan(1e-6);
    expect(Math.abs(centre.y)).toBeLessThan(1e-6);
  });
});
