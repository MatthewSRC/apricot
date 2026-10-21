import { act, render } from "@testing-library/react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { CameraRig } from "../CameraRig";
import { Box } from "../shapes";
import { type SceneTouchListener, useSceneTouches } from "../touches";
import { fingers, renderScene, stepFrames, viewHandler } from "./render";

const azimuthOf = (camera: THREE.Camera) =>
  (Math.atan2(camera.position.x, camera.position.z) * 180) / Math.PI;

function Listener({ listener, active = true }: { listener: SceneTouchListener; active?: boolean }) {
  useSceneTouches(listener, active);
  return null;
}

describe("scene touches", () => {
  it("claims touches only while something listens, and forwards every finger", async () => {
    const listener = { touch: vi.fn(), release: vi.fn(() => 42), wheel: vi.fn() };
    const view = await renderScene(<Listener listener={listener} active={false} />);
    const f = fingers(view.container);
    expect(f.wants()).toBe(false);
    const scene = view.container.firstElementChild as HTMLElement;
    expect(scene.style.touchAction).toBe("");
    view.update(<Listener listener={listener} />);
    expect(f.wants()).toBe(true);
    // Browsers leave touches to the scene, with no page scroll or zoom under them.
    expect(scene.style.touchAction).toBe("none");
    expect(f.keeps()).toBe(true);
    // Never taken over mid-gesture, so a button on the scene keeps a press that wobbles.
    expect(() => viewHandler(view.container, "onMoveShouldSetResponder")).toThrow();
    await f.down([[10, 20]], 1);
    await f.add(
      [
        [10, 20],
        [50, 60],
      ],
      2,
    );
    await f.move([[12, 22]], 3);
    // When one of two fingers lifts, the other continues. A stray end without fingers is ignored.
    await f.lift([[12, 22]], 4);
    await f.lift([], 5);
    await f.up(6);
    expect(listener.touch.mock.calls.map((c) => c[0].length)).toEqual([1, 2, 1, 1]);
    expect(listener.touch).toHaveBeenCalledWith([{ x: 12, y: 22 }], 3);
    expect(listener.release).toHaveBeenCalledWith(6);
    // On the web, a click that ends a drag is not a tap.
    const press = vi.spyOn(view.scene, "press");
    const click = viewHandler(view.container, "onClick");
    click({ nativeEvent: { offsetX: 1, offsetY: 2 } });
    expect(press).not.toHaveBeenCalled();
    click({ nativeEvent: { offsetX: 1, offsetY: 2 } });
    expect(press).toHaveBeenCalledTimes(1);
    // The mouse wheel, on the web.
    const element = view.container.firstElementChild as HTMLElement;
    const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    element.dispatchEvent(wheel);
    expect(listener.wheel).toHaveBeenCalledWith(120);
    expect(wheel.defaultPrevented).toBe(true);
    await f.down([[0, 0]], 7);
    await f.cancel(8);
    expect(listener.release).toHaveBeenCalledWith(8);
    view.update(null);
    expect(f.wants()).toBe(false);
    const ignored = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
    element.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
  });

  it("does nothing outside a scene, or with a timestamp missing", async () => {
    const listener = { touch: vi.fn(), release: vi.fn(() => 0) };
    render(<Listener listener={listener} />);
    const view = await renderScene(<Listener listener={listener} />);
    await act(async () => {
      (viewHandler(view.container, "onResponderGrant") as (event: unknown) => unknown)({
        nativeEvent: { touches: [{ pageX: 1, pageY: 2 }] },
      });
    });
    expect(listener.touch.mock.calls[0][1]).toBeTypeOf("number");
  });
});

describe("<CameraRig orbit>", () => {
  it("turns with a finger, keeps turning after a flick, and zooms with the wheel", async () => {
    const view = await renderScene(
      <>
        <Box />
        <CameraRig view={{ azimuth: 0, elevation: 20, distance: 10, target: [0, 0, 0] }} orbit />
      </>,
    );
    const camera = view.scene.camera;
    const f = fingers(view.container);
    await f.down([[100, 50]], 0);
    await f.move([[150, 50]], 16);
    // 50 points across a 200-point canvas turns 45°, with the subject turning right.
    expect(azimuthOf(camera)).toBeCloseTo(-45, 0);
    await f.up(20);
    const lifted = azimuthOf(camera);
    await stepFrames(5);
    expect(azimuthOf(camera)).toBeLessThan(lifted - 1);
    await stepFrames(200);
    const element = view.container.firstElementChild as HTMLElement;
    const before = camera.position.length();
    await act(async () => {
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: 200, cancelable: true }));
    });
    expect(camera.position.length()).toBeGreaterThan(before * 1.3);
  });

  it("says when a drag starts and ends, and keeps it from scroll views around it (Android)", async () => {
    const start = vi.fn();
    const end = vi.fn();
    const view = await renderScene(
      <>
        <Box />
        <CameraRig orbit onOrbitStart={start} onOrbitEnd={end} />
      </>,
    );
    const f = fingers(view.container);
    // Returning true from the grant blocks native responders (a ScrollView) on Android.
    let blocks: unknown;
    await act(async () => {
      blocks = f.grant([[100, 50]], 0);
    });
    expect(blocks).toBe(true);
    await f.move([[120, 50]], 16);
    await f.add(
      [
        [120, 50],
        [160, 90],
      ],
      20,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    await f.up(40);
    expect(end).toHaveBeenCalledTimes(1);
    // A drag taken away, as when an iOS scroll view starts scrolling, also ends.
    await f.down([[100, 50]], 50);
    await f.cancel(60);
    expect(start).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it("says when the fingers turn the camera (past a tap, or a pinch), and how far they moved", async () => {
    const start = vi.fn();
    const turn = vi.fn();
    const end = vi.fn();
    const view = await renderScene(
      <>
        <Box />
        <CameraRig orbit onOrbitStart={start} onTurnStart={turn} onOrbitEnd={end} />
      </>,
    );
    const f = fingers(view.container);
    // A tap starts but never turns.
    await f.down([[100, 50]], 0);
    await f.move([[103, 51]], 16);
    await f.up(40);
    expect([start.mock.calls.length, turn.mock.calls.length]).toEqual([1, 0]);
    expect(end.mock.calls[0][0].moved).toBeLessThan(5);
    // A drag turns once it moves past the tap distance.
    await f.down([[100, 50]], 100);
    await f.move([[106, 50]], 116);
    expect(turn).not.toHaveBeenCalled();
    await f.move([[140, 50]], 132);
    await f.move([[180, 50]], 148);
    await f.up(160);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(end.mock.calls[1][0].moved).toBeGreaterThan(50);
    // A pinch counts as turning at once.
    await f.down([[100, 50]], 200);
    await f.add(
      [
        [100, 50],
        [140, 90],
      ],
      210,
    );
    expect(turn).toHaveBeenCalledTimes(2);
    await f.up(260);
    view.unmount();
  });

  it("flies back to the view after `returnAfter`, and lets go of touches when turned off", async () => {
    const view = await renderScene(
      <>
        <Box />
        <CameraRig
          view={{ azimuth: 0, elevation: 20, distance: 10, target: [0, 0, 0] }}
          orbit={{ returnAfter: 0.05, inertia: false }}
          transition={0.2}
        />
      </>,
    );
    const camera = view.scene.camera;
    const f = fingers(view.container);
    await f.down([[100, 50]], 0);
    await f.move([[150, 50]], 16);
    await f.up(200);
    await stepFrames(2);
    expect(azimuthOf(camera)).toBeCloseTo(-45, 0);
    // The idle scene is woken by a timer to fly back.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await stepFrames(80);
    expect(azimuthOf(camera)).toBeCloseTo(0, 0);
    view.update(
      <>
        <Box />
        <CameraRig view={{ azimuth: 0, elevation: 20, distance: 10, target: [0, 0, 0] }} />
      </>,
    );
    expect(f.wants()).toBe(false);
    view.unmount();
  });

  it("lets one listener claim a gesture for itself, in the scene's own coordinates", async () => {
    const claimed: { x: number; y: number }[][] = [];
    const greedy = {
      capture: vi.fn((points: { x: number; y: number }[]) => points[0].x < 100),
      touch: vi.fn((points: { x: number; y: number }[]) => void claimed.push(points)),
      release: vi.fn(() => 0),
    };
    const other = { touch: vi.fn(), release: vi.fn(() => 0) };
    const view = await renderScene(
      <>
        <Listener listener={greedy} />
        <Listener listener={other} />
      </>,
    );
    // The scene sits 40 points down the page, below a header.
    const f = fingers(view.container, { x: 0, y: 40 });
    await f.down([[50, 90]], 0);
    await f.move([[60, 95]], 16);
    await f.up(32);
    // A claimed gesture goes only to the claimer, with points from the scene's top-left.
    expect(greedy.capture).toHaveBeenCalledWith([{ x: 50, y: 50 }], 0);
    expect(claimed.at(-1)).toEqual([{ x: 60, y: 55 }]);
    expect(greedy.release).toHaveBeenCalledTimes(1);
    expect(other.touch).not.toHaveBeenCalled();
    expect(other.release).not.toHaveBeenCalled();
    // An unclaimed gesture, starting on the right, goes to every listener.
    await f.down([[150, 90]], 100);
    await f.up(132);
    expect(other.touch).toHaveBeenCalledTimes(1);
    expect(other.release).toHaveBeenCalledTimes(1);
  });
});
