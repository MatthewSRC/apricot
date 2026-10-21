import { EMITTERS } from "@apricotjs/core";
import { act } from "@testing-library/react";
import { createRef } from "react";
import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Particles, type ParticlesHandle } from "../Particles";
import { renderScene, stepFrames } from "./render";
import { frames } from "./setup";

afterEach(() => vi.restoreAllMocks());

describe("<Particles>", () => {
  it("sends out bursts by name or its own, drawing frames only while one is alive", async () => {
    const sparks = createRef<ParticlesHandle>();
    const view = await renderScene(<Particles ref={sparks} max={50} position={[0, 1, 0]} />);
    await stepFrames(2);
    const object = view.scene.scene.getObjectByName("Particles") as THREE.Sprite;
    expect(object.position.y).toBe(1);
    // With nothing alive, the scene sleeps and the particles are not drawn.
    expect(frames.queue).toHaveLength(0);
    expect(object.visible).toBe(false);
    act(() => sparks.current?.burst("sparkle", { at: [0, 2, 0], count: 5 }));
    expect(object.visible).toBe(true);
    expect(frames.queue.length).toBeGreaterThan(0);
    // Time advances by each frame's delta; the first frame after sleeping has none.
    await stepFrames(1);
    await stepFrames(5, 100);
    expect(frames.queue.length).toBeGreaterThan(0);
    // After the sparkle's longest life (1.1 s), the scene sleeps again and the particles are hidden.
    await stepFrames(8, 100);
    expect(frames.queue).toHaveLength(0);
    expect(object.visible).toBe(false);
    // A custom burst.
    act(() => sparks.current?.burst({ at: [1, 0, 0], count: 3, life: 0.2, colors: ["#00ff00"] }));
    await stepFrames(1);
    expect(frames.queue.length).toBeGreaterThan(0);
    view.update(null);
    expect(view.scene.scene.getObjectByName("Particles")).toBeUndefined();
  });

  it("streams while `emit` is set, changing it in place, and by code through the ref", async () => {
    const sparks = createRef<ParticlesHandle>();
    const view = await renderScene(<Particles ref={sparks} max={200} emit="smoke" />);
    const object = () => view.scene.scene.getObjectByName("Particles") as THREE.Sprite;
    // While the stream runs, frames keep coming.
    await stepFrames(10, 50);
    expect(frames.queue.length).toBeGreaterThan(0);
    expect(object().visible).toBe(true);
    // Moving it updates the same stream.
    const set = object();
    view.update(<Particles ref={sparks} max={200} emit={{ ...EMITTERS.smoke, at: [3, 0, 0] }} />);
    await stepFrames(5, 50);
    expect(object()).toBe(set);
    // Turned off, live particles finish and then the scene sleeps.
    view.update(<Particles ref={sparks} max={200} emit={false} />);
    await stepFrames(50, 100);
    expect(frames.queue).toHaveLength(0);
    expect(object().visible).toBe(false);
    // A stream started from code.
    let stream: ReturnType<ParticlesHandle["emit"]> | undefined;
    act(() => {
      stream = sparks.current?.emit("sparkler", { at: [0, 1, 0] });
    });
    expect(stream?.running).toBe(true);
    await stepFrames(3);
    expect(frames.queue.length).toBeGreaterThan(0);
    act(() => stream?.stop());
    await stepFrames(20, 100);
    expect(frames.queue).toHaveLength(0);
    // A texture creates a new set that draws it.
    const picture = new THREE.Texture();
    view.update(<Particles ref={sparks} max={200} texture={picture} />);
    await stepFrames(1);
    expect(object()).not.toBe(set);
    view.unmount();
  });
});
