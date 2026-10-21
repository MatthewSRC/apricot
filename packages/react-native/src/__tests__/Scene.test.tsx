import { type ApricotScene, sceneRegistry } from "@apricotjs/core";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { AppState, Platform, Text } from "react-native";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { useScene } from "../context";
import { useParent } from "../parent";
import { Scene } from "../Scene";
import { Box } from "../shapes";
import { fireLayout, renderScene, stepFrames, viewHandler } from "./render";
import { canvasState, frames, rendererState } from "./setup";

describe("<Scene>", () => {
  it("starts the renderer, then renders its children", async () => {
    const { scene } = await renderScene(<Text>child</Text>);
    expect(screen.getByText("child")).toBeTruthy();
    expect(scene.isAttached).toBe(true);
    await stepFrames();
    expect(rendererState.renders).toBe(1);
    expect(canvasState.presents).toBe(1);
  });

  it("applies look, camera and background options", async () => {
    const { scene } = await renderScene(null, {
      look: "studio",
      camera: { position: [1, 2, 3], fov: 35 },
      background: "#101010",
    });
    expect(scene.scene.getObjectByName("apricot:look")).toBeDefined();
    expect(scene.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(scene.camera.fov).toBe(35);
  });

  it("stops drawing while paused, and while the app is in the background", async () => {
    let change: (state: string) => void = () => {};
    const addEventListener = vi.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
      change = listener as (state: string) => void;
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const view = await renderScene(null, { paused: true });
    expect(view.scene.isPaused).toBe(true);
    view.rerender(<Scene linger={0} paused={false} />);
    expect(view.scene.isPaused).toBe(false);
    act(() => change("background"));
    expect(view.scene.isPaused).toBe(true);
    act(() => change("active"));
    expect(view.scene.isPaused).toBe(false);
    view.unmount();
    addEventListener.mockRestore();
  });

  it("brings in a paused scene's content once the scenes on screen show theirs", async () => {
    const mounted: string[] = [];
    function Probe({ name }: { name: string }) {
      useEffect(() => {
        mounted.push(name);
      }, [name]);
      return null;
    }
    const tree = (next: boolean) => (
      <>
        <Scene linger={0}>
          <Box />
          <Probe name="shown" />
        </Scene>
        <Scene linger={0} paused={next}>
          <Probe name="next" />
        </Scene>
      </>
    );
    const view = render(tree(true));
    await act(async () => {
      await Promise.resolve();
    });
    // The next page waits until the scene in view has drawn.
    expect(mounted).toEqual(["shown"]);
    await stepFrames(3);
    expect(mounted).toEqual(["shown", "next"]);
    view.unmount();
    // A paused scene alone, or one that is shown, mounts its content at once.
    mounted.length = 0;
    const alone = render(
      <Scene linger={0} paused>
        <Probe name="alone" />
      </Scene>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted).toEqual(["alone"]);
    alone.unmount();
  });

  it("follows a new background colour", async () => {
    const view = await renderScene(null, { background: "#101010" });
    const color = () => (view.scene.scene.background as THREE.Color).getHexString();
    expect(color()).toBe("101010");
    view.rerender(<Scene linger={0} background="#203040" />);
    expect(color()).toBe("203040");
    view.rerender(<Scene linger={0} background="#101010" />);
    expect(color()).toBe("101010");
    view.unmount();
  });

  it("sets a procedural environment when asked", async () => {
    const { scene } = await renderScene(null, { environment: "studio" });
    expect((scene.scene as unknown as { environmentNode: { isNode: boolean } }).environmentNode.isNode).toBe(
      true,
    );
  });

  it("provides the scene and the scene root as parent", async () => {
    let seen: { scene: unknown; parent: unknown } | null = null;
    function Probe() {
      seen = { scene: useScene(), parent: useParent() };
      return null;
    }
    const { scene } = await renderScene(<Probe />);
    expect(seen).toEqual({ scene, parent: scene.scene });
  });

  it("switches frameloop mode when the prop changes", async () => {
    const view = await renderScene(null, { frameloop: "demand" });
    await stepFrames();
    view.rerender(<Scene frameloop="always" />);
    await stepFrames(3);
    expect(rendererState.renders).toBe(4);
  });

  it("releases the scene on unmount", async () => {
    const before = sceneRegistry.size;
    const view = await renderScene();
    expect(sceneRegistry.size).toBe(before + 1);
    view.unmount();
    expect(sceneRegistry.size).toBe(before);
    expect(view.scene.isAttached).toBe(false);
  });

  it("reports a renderer that fails to start", async () => {
    rendererState.failInit = true;
    const onError = vi.fn();
    render(<Scene onError={onError} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "no GPU" }));
  });

  it("logs the error when there is no onError", async () => {
    rendererState.failInit = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Scene />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(log).toHaveBeenCalledWith("[apricot] Scene failed to start:", expect.any(Error));
    log.mockRestore();
  });

  it("wraps non-Error failures", async () => {
    rendererState.failInit = true;
    const onError = vi.fn();
    rendererState.initGate = Promise.reject("plain string");
    rendererState.initGate.catch(() => {});
    render(<Scene onError={onError} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "plain string" }));
  });

  it("gives up when the canvas never gets a size", async () => {
    canvasState.unavailable = true;
    const onError = vi.fn();
    render(<Scene onError={onError} />);
    for (let i = 0; i < 121; i++) {
      await act(async () => {
        frames.step();
      });
    }
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "WebGPU canvas context not available" }),
    );
  });

  it("stops quietly when unmounted while waiting for the canvas", async () => {
    canvasState.unavailable = true;
    const onError = vi.fn();
    const before = sceneRegistry.size;
    const view = render(<Scene onError={onError} />);
    view.unmount();
    await act(async () => {
      frames.step();
    });
    expect(onError).not.toHaveBeenCalled();
    expect(sceneRegistry.size).toBe(before);
  });

  it("detaches a scene whose renderer finished starting after unmount", async () => {
    let open: () => void = () => {};
    rendererState.initGate = new Promise((resolve) => (open = resolve));
    const onCreated = vi.fn();
    const before = sceneRegistry.size;
    const view = render(<Scene onCreated={onCreated} />);
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();
    await act(async () => {
      open();
      await Promise.resolve();
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(sceneRegistry.size).toBe(before);
  });

  it("does not report errors after unmount", async () => {
    let fail: () => void = () => {};
    rendererState.initGate = new Promise((_, reject) => (fail = () => reject(new Error("late"))));
    const onError = vi.fn();
    const view = render(<Scene onError={onError} />);
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();
    await act(async () => {
      fail();
      await Promise.resolve();
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("shows the debug HUD", async () => {
    await renderScene(null, { debug: true });
    expect(screen.getByText(/fps · render/)).toBeTruthy();
  });

  it("passes pointerEvents through as a style", async () => {
    const { container } = await renderScene(null, { pointerEvents: "none", testID: "scene" });
    expect(container.innerHTML).toContain("pointer-events");
  });

  it("resizes the scene when its view is laid out again, and still calls onLayout", async () => {
    const onLayout = vi.fn();
    const { scene, container } = await renderScene(null, { onLayout });
    expect(scene.size).toMatchObject({ width: 200, height: 100 });
    await fireLayout(container, 300, 600);
    expect(scene.size).toMatchObject({ width: 300, height: 600 });
    expect(scene.camera.aspect).toBeCloseTo(0.5);
    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it("takes a size change that comes while the renderer is still starting", async () => {
    let scene: ApricotScene | null = null;
    const view = render(<Scene onCreated={(s) => (scene = s)} />);
    // A second layout, as from a sheet animating in, arrives before the scene has attached.
    await fireLayout(view.container, 300, 600);
    await act(async () => {
      await Promise.resolve();
    });
    expect((scene as ApricotScene | null)?.size).toMatchObject({ width: 300, height: 600 });
    view.unmount();
  });

  it("ignores layout before the scene is ready", async () => {
    canvasState.unavailable = true;
    const view = render(<Scene onError={() => {}} />);
    await fireLayout(view.container, 300, 600);
    view.unmount();
    canvasState.unavailable = false;
  });

  it("turns short, still touches into taps on native, and still calls the app's touch handlers", async () => {
    const original = Platform.OS;
    (Platform as { OS: string }).OS = "ios";
    try {
      const onTouchStart = vi.fn();
      const onTouchEnd = vi.fn();
      const view = await renderScene(null, { onTouchStart, onTouchEnd });
      const press = vi.spyOn(view.scene, "press");
      const start = viewHandler(view.container, "onTouchStart");
      const end = viewHandler(view.container, "onTouchEnd");
      const touch = (x: number, y: number, timestamp: number, touches = 1) => ({
        nativeEvent: { locationX: x, locationY: y, timestamp, touches: Array(touches).fill({}) },
      });
      start(touch(50, 40, 0));
      end(touch(53, 42, 120));
      expect(press).toHaveBeenCalledWith(53, 42);
      expect(onTouchStart).toHaveBeenCalled();
      expect(onTouchEnd).toHaveBeenCalled();
      // A drag, a long press, a pinch and a stray end are not taps.
      start(touch(50, 40, 0));
      end(touch(90, 40, 100));
      start(touch(50, 40, 0));
      end(touch(50, 40, 900));
      start(touch(50, 40, 0, 2));
      end(touch(50, 40, 50));
      end(touch(50, 40, 50));
      expect(press).toHaveBeenCalledTimes(1);
    } finally {
      (Platform as { OS: string }).OS = original;
    }
  });

  it("turns clicks into taps on web", async () => {
    const view = await renderScene(null);
    const press = vi.spyOn(view.scene, "press");
    viewHandler(view.container, "onClick")({ nativeEvent: { offsetX: 12, offsetY: 34 } });
    expect(press).toHaveBeenCalledWith(12, 34);
  });
});

describe("<Scene> in a browser without a WebGPU adapter", () => {
  // The browser's <canvas>, which react-native-webgpu gives the id rnwgpu-canvas-<contextId>.
  const browserCanvas = (webgl: unknown) => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
      kind === "webgl2" ? webgl : null) as never);
    const element = document.createElement("canvas");
    element.id = "rnwgpu-canvas-7";
    Object.defineProperty(element, "clientWidth", { value: 200 });
    Object.defineProperty(element, "clientHeight", { value: 100 });
    document.body.append(element);
    canvasState.contextId = 7;
    return element;
  };

  it("draws with WebGL 2", async () => {
    const webgl: { canvas?: HTMLCanvasElement; getExtension: () => null } = { getExtension: () => null };
    webgl.canvas = browserCanvas(webgl);
    try {
      const { scene } = await renderScene(null);
      expect(scene.isAttached).toBe(true);
      expect(scene.report().events.find((e) => e.kind === "attached")?.detail).toMatchObject({
        backend: "webgl",
      });
      await stepFrames();
      expect(rendererState.renders).toBe(1);
      // Browsers present on their own.
      expect(canvasState.presents).toBe(0);
    } finally {
      webgl.canvas.remove();
      vi.restoreAllMocks();
    }
  });

  it("fails with a message that says so where there is no WebGL 2 either", async () => {
    const element = browserCanvas(null);
    const onError = vi.fn();
    try {
      render(<Scene onError={onError} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "[apricot] WebGPU isn't available on this device, and neither is WebGL 2",
        }),
      );
    } finally {
      element.remove();
      vi.restoreAllMocks();
    }
  });
});
