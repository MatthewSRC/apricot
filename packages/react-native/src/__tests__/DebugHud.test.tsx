import { FrameStats } from "@apricotjs/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebugHud, diagnosticsJson, shareDiagnostics } from "../DebugHud";
import { renderScene } from "./render";

describe("<DebugHud>", () => {
  it("shows live stats and refreshes twice a second until unmounted", () => {
    vi.useFakeTimers();
    let t = 0;
    const stats = new FrameStats(10, () => t);
    const view = render(<DebugHud stats={stats} />);
    expect(screen.getByText(/0 fps/)).toBeTruthy();
    // One second of frames at 60 Hz. The HUD counts the frames rendered in the last second.
    for (let i = 0; i < 60; i++) {
      stats.begin();
      t += 3;
      stats.beforePresent();
      t += 1;
      stats.end();
      t += 12.67;
    }
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText(/(59|60) fps · render 3\.0 ms · present 1\.0 ms/)).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("diagnostics sharing", () => {
  it("shows the GPU's time when the scene measures it", async () => {
    const view = await renderScene(null, { debug: true });
    view.scene.gpuMs = 6.4;
    const hud = render(<DebugHud stats={view.scene.stats} scene={view.scene} />);
    expect(screen.getAllByText(/gpu 6\.4 ms/).length).toBeGreaterThan(0);
    hud.unmount();
    view.unmount();
  });

  it("shares the scene's report with device details from the HUD", async () => {
    const { Share } = await import("react-native");
    const share = vi.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    const view = await renderScene(null, { debug: true });
    await act(async () => {
      fireEvent.click(view.getByLabelText("Share diagnostics"));
    });
    expect(share).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((share.mock.calls[0][0] as { message: string }).message);
    expect(sent.device.os).toBe("web");
    expect(sent.summary).toBeDefined();
    expect(sent.events[0].kind).toBe("attached");
    share.mockRestore();
  });

  it("logs the report where sharing is not available", async () => {
    const { Share } = await import("react-native");
    vi.spyOn(Share, "share").mockRejectedValue(new Error("not supported"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const view = await renderScene(null);
    await shareDiagnostics(view.scene, { app: "test" });
    expect(log).toHaveBeenCalledWith("[apricot] diagnostics:", expect.stringContaining('"app":"test"'));
    expect(JSON.parse(diagnosticsJson(view.scene)).device.os).toBe("web");
    vi.restoreAllMocks();
  });
});
