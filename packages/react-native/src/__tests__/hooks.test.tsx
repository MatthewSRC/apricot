import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScene } from "../context";
import { useFrame } from "../hooks";
import { useParent } from "../parent";
import { renderScene, stepFrames } from "./render";

describe("useFrame", () => {
  it("runs the latest callback before each frame and keeps the loop awake while it returns true", async () => {
    const calls: string[] = [];
    let animating = true;
    function Animated({ label }: { label: string }) {
      useFrame(() => {
        calls.push(label);
        return animating;
      });
      return null;
    }
    const view = await renderScene(<Animated label="a" />);
    await stepFrames(2);
    view.update(<Animated label="b" />);
    animating = false;
    await stepFrames(3);
    expect(calls).toEqual(["a", "a", "b"]);
  });

  it("stops calling after unmount", async () => {
    const callback = vi.fn();
    function Animated() {
      useFrame(callback);
      return null;
    }
    const view = await renderScene(<Animated />);
    await stepFrames();
    view.unmount();
    await stepFrames();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("context hooks outside <Scene>", () => {
  it("throw helpful errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    function UsesScene() {
      useScene();
      return null;
    }
    function UsesParent() {
      useParent();
      return null;
    }
    expect(() => render(<UsesScene />)).toThrow("useScene() must be used inside <Scene>");
    expect(() => render(<UsesParent />)).toThrow("Apricot components must be used inside <Scene>");
    log.mockRestore();
  });
});
