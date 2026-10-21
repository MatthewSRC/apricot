import * as THREE from "three/webgpu";
import { expect, it, vi } from "vitest";
import { Merged } from "../Merged";
import { Placeable, Placement } from "../Placement";
import { Box } from "../shapes";
import { fingers, renderScene, stepFrames } from "./render";

it("puts things on a turned surface seen at a slant, as in a room", async () => {
  const onChange = vi.fn();
  const camera = { position: [-6.7, 8.15, 9.26] as const, target: [0, 1, 0] as const, fov: 30 };
  const view = await renderScene(
    <Placement selected="mug" onChange={onChange} bounds={[-2.1, -1.5, 2.1, 1.5]}>
      <Placeable id="desk" surface position={[1.79, 0, 0.82]} turn={90}>
        <Merged>
          <Box size={[1.25, 0.045, 0.62]} position={[0, 0.74, 0]} />
        </Merged>
      </Placeable>
      <Placeable id="mug" on="surface" position={[-0.5, 0, 0]}>
        <Box size={[0.3, 0.3, 0.3]} position={[0, 0.15, 0]} />
      </Placeable>
    </Placement>,
    { camera },
  );
  await stepFrames(2);
  const cam = view.scene.camera;
  cam.updateMatrixWorld();
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return [(v.x + 1) * 100, (1 - v.y) * 50];
  };
  const f = fingers(view.container);
  await f.down([toScreen(-0.5, 0.15, 0)], 0);
  await f.move([toScreen(0, 0.4, 0.4)], 16);
  await f.move([toScreen(1.79, 0.7625, 0.82)], 32);
  await stepFrames(1);
  await f.up(48);
  const [[id, place]] = onChange.mock.calls;
  expect(id).toBe("mug");
  expect(place.position[1]).toBeCloseTo(0.7625);
  // On the desk's top, which runs along z (turned 90°): within 0.31 m of its middle across, 0.625 along.
  expect(Math.abs(place.position[0] - 1.79)).toBeLessThan(0.31);
  expect(Math.abs(place.position[2] - 0.82)).toBeLessThan(0.625);
});
