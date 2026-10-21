import { act } from "@testing-library/react";
import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { defineBehavior } from "../behavior";
import { Group } from "../Group";
import { Spin } from "../Spin";
import { renderScene, stepFrames } from "./render";
import { rendererState, sharedValue } from "./setup";

describe("defineBehavior", () => {
  const Bob = defineBehavior({
    name: "Bob",
    defaults: { height: 1, label: "x" },
    frame: (object, { height }, { time }) => {
      object.position.y = height * Math.sin(time);
      return height !== 0;
    },
  });

  it("names the component and its group, and wraps children", async () => {
    expect(Bob.displayName).toBe("Bob");
    const view = await renderScene(
      <Bob height={2}>
        <Group name="child" />
      </Bob>,
    );
    const group = view.scene.scene.getObjectByName("Bob");
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group?.getObjectByName("child")).toBeDefined();
  });

  it("passes current props (with defaults) and keeps the loop awake while moving", async () => {
    const seen: unknown[] = [];
    const Probe = defineBehavior({
      name: "Probe",
      defaults: { a: 1, b: 2 },
      frame: (_o, props) => {
        seen.push({ ...props });
        return props.a > 0;
      },
    });
    const view = await renderScene(<Probe a={5} />);
    await stepFrames(3);
    expect(seen[0]).toEqual({ a: 5, b: 2 });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    view.update(<Probe a={0} />);
    await stepFrames(2);
    const count = seen.length;
    await stepFrames(3);
    expect(seen.length).toBe(count); // asleep
  });
});

describe("<Spin>", () => {
  it("rotates its children around Y by default", async () => {
    const view = await renderScene(<Spin speed={Math.PI} />);
    await stepFrames(1); // first frame: delta 0
    await stepFrames(1, 500);
    const spin = view.scene.scene.getObjectByName("Spin");
    expect(spin?.rotation.y).toBeCloseTo(Math.PI / 10); // delta capped at 0.1 s
  });

  it("sleeps at speed 0 and wakes when a shared speed changes", async () => {
    const speed = sharedValue(0);
    await renderScene(<Spin speed={speed as never} axis={[1, 0, 0]} />);
    await stepFrames(3);
    const idle = rendererState.renders;
    await stepFrames(3);
    expect(rendererState.renders).toBe(idle);
    await act(async () => {
      speed.value = 2;
    });
    await stepFrames(3);
    expect(rendererState.renders).toBeGreaterThan(idle);
  });
});
