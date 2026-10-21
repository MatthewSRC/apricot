import { act } from "@testing-library/react";
import { Platform, Text } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Label } from "../Label";
import { loadModelBytes } from "../Model";
import { load, needs, optional } from "../optional";
import { Box } from "../shapes";
import { fileStorage } from "../useLayout";
import { renderScene, stepFrames } from "./render";

// The installed packages, restored after each test.
const installed = { ...optional };
afterEach(() => {
  Object.assign(optional, installed);
  vi.restoreAllMocks();
});

describe("optional packages", () => {
  it("are null when not installed, and say what to install when needed", () => {
    expect(
      load(() => {
        throw new Error("Cannot find module 'react-native-reanimated'");
      }),
    ).toBeNull();
    expect(load(() => 42)).toBe(42);
    expect(needs("expo-asset", "Loading a bundled model").message).toBe(
      "[apricot] Loading a bundled model needs expo-asset: npx expo install expo-asset",
    );
  });

  it("without expo-asset or expo-file-system: bundled models say what to install, URLs still load", async () => {
    optional.asset = null;
    await expect(loadModelBytes(7)).rejects.toThrow("npx expo install expo-asset expo-file-system");
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ArrayBuffer(4)));
    expect((await loadModelBytes("https://example.com/car.glb")).byteLength).toBe(4);
    expect(fetched).toHaveBeenCalled();
    optional.asset = installed.asset;
    optional.fileSystem = null;
    const os = Platform.OS;
    Platform.OS = "ios";
    try {
      // The asset is found, but there is no file system to read it with.
      await expect(loadModelBytes(7)).rejects.toThrow("npx expo install expo-file-system");
    } finally {
      Platform.OS = os;
    }
  });

  it("without expo-file-system: layouts work for the run, not kept, and it says so once", async () => {
    optional.fileSystem = null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const os = Platform.OS;
    Platform.OS = "android";
    try {
      const storage = fileStorage();
      expect(await storage.read("room")).toBeNull();
      await storage.write("room", "text");
      expect(await storage.read("room")).toBeNull();
    } finally {
      Platform.OS = os;
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("npx expo install expo-file-system");
  });

  it("without Reanimated: props are plain values, and labels follow by rendering again", async () => {
    optional.reanimated = null;
    optional.worklets = null;
    const view = await renderScene(
      <>
        <Box position={[1, 0, 0]} name="box" />
        <Label position={[0, 0, 0]}>
          <Text>Station</Text>
        </Label>
      </>,
    );
    await stepFrames(2);
    expect(view.scene.scene.getObjectByName("box")?.position.x).toBe(1);
    const style = () => (view.getByText("Station").parentElement as HTMLElement).style;
    expect(style().transform).toContain("translateX(100px)");
    expect(style().opacity).toBe("1");
    view.scene.camera.position.x = 2;
    view.scene.camera.updateMatrixWorld();
    await act(async () => view.scene.invalidate());
    await stepFrames(1);
    expect(style().transform).not.toContain("translateX(100px)");
  });
});
