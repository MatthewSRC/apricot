import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { ClipPlayer } from "../clips";

/** A lid that rises from y 0 to y 2 over 2 seconds. */
const model = () => {
  const root = new THREE.Group();
  const lid = new THREE.Object3D();
  lid.name = "Lid";
  root.add(lid);
  const track = new THREE.VectorKeyframeTrack("Lid.position", [0, 2], [0, 0, 0, 0, 2, 0]);
  const clip = new THREE.AnimationClip("LidOpen", 2, [track]);
  return { root, lid, player: new ClipPlayer(root, [clip]) };
};

describe("ClipPlayer", () => {
  it("lists clip names", () => {
    expect(model().player.names).toEqual(["LidOpen"]);
  });

  it("scrubs a clip to a fraction of its length, clamped", () => {
    const { lid, player } = model();
    player.seek("LidOpen", 0.25);
    expect(lid.position.y).toBeCloseTo(0.5);
    player.seek("LidOpen", 3);
    expect(lid.position.y).toBeCloseTo(2);
    player.seek("LidOpen", -1);
    expect(lid.position.y).toBeCloseTo(0);
    // Scrubbing is not playing.
    expect(player.update(0.5)).toBe(false);
  });

  it("plays once and stops at the end", () => {
    const { lid, player } = model();
    player.play("LidOpen");
    expect(player.update(1)).toBe(true);
    expect(lid.position.y).toBeCloseTo(1);
    expect(player.update(5)).toBe(false);
    expect(lid.position.y).toBeCloseTo(2);
  });

  it("loops until stopped", () => {
    const { lid, player } = model();
    player.play("LidOpen", { loop: true });
    player.update(1.5);
    expect(player.update(1)).toBe(true);
    expect(lid.position.y).toBeCloseTo(0.5);
    player.stop("LidOpen");
    expect(player.update(1)).toBe(false);
    player.stop("Unknown");
    player.dispose();
  });

  it("names the clips it has when asked for one it does not", () => {
    expect(() => model().player.seek("Open", 0)).toThrow(/No animation "Open".*LidOpen/);
    expect(() => new ClipPlayer(new THREE.Group(), []).play("Open")).toThrow(/has: none/);
  });
});
