import { act, render } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { Text } from "react-native";
import { describe, expect, it, vi } from "vitest";

// The mock must not load three.js or the engine, which loads three.js.
vi.mock("three", () => {
  throw new Error("three.js loaded");
});
vi.mock("three/webgpu", () => {
  throw new Error("three.js loaded");
});
vi.mock("@apricotjs/core", () => {
  throw new Error("@apricotjs/core loaded");
});

describe("@apricotjs/react-native/mock", () => {
  it("renders a screen with a scene: a View, its children's text, and a real useLayout", async () => {
    const apricot = await import("../mock");
    const { Scene, CameraRig, Placement, Placeable, Box, Label, Model, useLayout, useScene, useFrame } =
      apricot;
    const handle = createRef<{ turnBy: (id: string, degrees: number) => boolean }>();
    type Item = { id: string; position: [number, number, number]; turn: number };
    let layout!: ReturnType<typeof useLayout<Item>>;
    function Room() {
      layout = useLayout<Item>([{ id: "sofa", position: [0, 0, 0], turn: 0 }]);
      const scene = useScene();
      useFrame(() => scene.invalidate());
      return (
        <Scene style={{ flex: 1 }}>
          <CameraRig orbit />
          <Placement ref={handle}>
            {layout.items.map((p) => (
              <Placeable key={p.id} id={p.id} position={p.position}>
                <Box />
                <Model src="https://example.com/sofa.glb" />
                <Label>
                  <Text>{`${p.id} ${p.position[0]}`}</Text>
                </Label>
              </Placeable>
            ))}
          </Placement>
        </Scene>
      );
    }
    const view = render(<Room />);
    expect(view.getByTestId("apricot-scene")).toBeTruthy();
    expect(view.getByText("sofa 0")).toBeTruthy();
    // A purchase that undo doesn't take back.
    act(() => layout.add({ id: "lamp", position: [1, 0, 0], turn: 0 }, { history: false }));
    expect(view.getByText("lamp 1")).toBeTruthy();
    expect(layout.canUndo).toBe(false);
    // Handles, hooks and helpers do nothing and do not throw.
    expect(() => handle.current?.turnBy("sofa", 90)).not.toThrow();
    expect(apricot.useModel()).toEqual({ object: null, animations: [], error: null });
    expect(apricot.smoothOutline([[0, 0]])).toEqual([[0, 0]]);
    expect(() => new apricot.Path([[0, 0, 0]]).length).not.toThrow();
    const Wobble = apricot.defineBehavior({ name: "Wobble" });
    expect(render(<Wobble>{"inside"}</Wobble>).getByText("inside")).toBeTruthy();
  });

  it("has every component render, every hook and helper run, doing nothing", async () => {
    const apricot: Record<string, unknown> = await import("../mock");
    const names = Object.keys(apricot).filter((name) => typeof apricot[name] === "function");
    const hooks = names.filter((name) => name.startsWith("use") && name !== "useLayout");
    const components = names.filter(
      (name) => /^[A-Z][a-z]/.test(name) && !["Path", "Trip", "PresetMaterial"].includes(name),
    );
    const call = (name: string, ...args: unknown[]) =>
      (apricot[name] as (...a: unknown[]) => unknown)(...args);
    function Everything() {
      for (const hook of hooks) {
        const value = call(hook, "x");
        if (typeof value === "function") (value as () => unknown)();
      }
      return (
        <>
          {components.map((name) => {
            const Component = apricot[name] as (props: { children: ReactNode }) => null;
            return (
              <Component key={name}>
                <Text>{name}</Text>
              </Component>
            );
          })}
        </>
      );
    }
    const view = render(<Everything />);
    for (const name of components) expect(view.getAllByText(name).length).toBeGreaterThan(0);
    for (const name of names.filter(
      (n) => !hooks.includes(n) && !components.includes(n) && n !== "useLayout",
    ))
      expect(() => call(name, { name: "x" }, {})).not.toThrow();
    expect(apricot.diagnosticsJson && call("diagnosticsJson")).toBe("{}");
    expect(await call("loadModelBytes")).toBeInstanceOf(ArrayBuffer);
  });
  it("starts its scene, or fails it, when told to (mockScene)", async () => {
    const { Scene, mockScene } = await import("../mock");
    const onCreated = vi.fn();
    const onReady = vi.fn();
    const onError = vi.fn();
    const props = { onCreated, onReady, onError };
    // By default it never starts.
    render(<Scene {...props} />).unmount();
    expect([onCreated, onReady, onError].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    mockScene({ ready: true });
    render(<Scene {...props} />).unmount();
    expect([onCreated, onReady, onError].map((f) => f.mock.calls.length)).toEqual([1, 1, 0]);
    const error = new Error("no WebGPU");
    mockScene({ error });
    render(<Scene {...props} />).unmount();
    expect(onError).toHaveBeenCalledWith(error);
    mockScene();
  });
});
