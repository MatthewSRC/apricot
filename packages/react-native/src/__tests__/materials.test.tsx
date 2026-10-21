import { waitFor } from "@testing-library/react";
import { Platform } from "react-native";
import { texture } from "three/tsl";
import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../../../core/src/__tests__/glb";
import { Primitive } from "../Group";
import { jointOf, resolvePart } from "../kit";
import { defineModelKit, Model } from "../Model";
import { sharedMaterialCount, useMaterial } from "../materials";
import { renderScene, stepFrames } from "./render";
import { assetState } from "./setup";

const originalOS = Platform.OS;
const asNative = () => {
  (Platform as { OS: string }).OS = "ios";
};
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
});

const meshNamed = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Mesh;

describe("<Model materials>", () => {
  it("applies presets by part name, animates colour changes and restores originals", async () => {
    asNative();
    assetState.files.set("file:///asset-31", makeGlb(["body", "wheel_fl"]));
    let loaded: THREE.Group | null = null;
    const view = await renderScene(
      <Model
        src={31}
        onLoad={(o) => (loaded = o)}
        materials={{ body: { preset: "car-paint", color: "#ff0000" } }}
      />,
    );
    await waitFor(() => expect(loaded).not.toBeNull());
    const model = loaded as unknown as THREE.Group;
    const body = meshNamed(model, "body");
    const wheel = meshNamed(model, "wheel_fl");
    const original = wheel.material;
    await waitFor(() => expect((body.material as THREE.Material).name).toBe("car-paint"));
    const paint = body.material as THREE.MeshPhysicalNodeMaterial;
    expect(paint.color.getHexString()).toBe("ff0000");
    expect(wheel.material).toBe(original);

    // A new colour animates on the same material.
    view.update(
      <Model
        src={31}
        onLoad={(o) => (loaded = o)}
        materials={{ body: { preset: "car-paint", color: "#0000ff", transition: 0.2 } }}
      />,
    );
    await stepFrames(3, 16);
    expect(body.material).toBe(paint);
    expect(paint.color.b).toBeGreaterThan(0);
    expect(paint.color.r).toBeGreaterThan(0);
    await stepFrames(30, 16);
    expect(paint.color.getHexString()).toBe("0000ff");

    // A new preset replaces the material; removing the override restores the original.
    view.update(<Model src={31} onLoad={(o) => (loaded = o)} materials={{ body: "chrome" }} />);
    await waitFor(() => expect((body.material as THREE.Material).name).toBe("chrome"));
    view.update(<Model src={31} onLoad={(o) => (loaded = o)} />);
    await waitFor(() => expect((body.material as THREE.Material).name).not.toBe("chrome"));
    expect(wheel.material).toBe(original);
  });

  it("uses kit part names, raw selectors, three.js materials, and warns about matches to nothing", async () => {
    asNative();
    assetState.files.set("file:///asset-32", makeGlb(["carrozzeria", "ruota_ant_sx", "ruota_ant_dx"]));
    const kit = defineModelKit(32, {
      shell: "carrozzeria",
      wheels: "ruota_*",
      door: { select: "porta_*", hinge: "front", range: [0, 70] },
    });
    expect(resolvePart(kit, "wheels")).toBe("ruota_*");
    expect(resolvePart(kit, "door")).toBe("porta_*");
    expect(resolvePart(kit, "ruota_ant_sx")).toBe("ruota_ant_sx");
    expect(resolvePart(undefined, "x")).toBe("x");
    expect(jointOf(kit, "door")?.range).toEqual([0, 70]);
    expect(jointOf(kit, "wheels")).toBeUndefined();
    const custom = new THREE.MeshBasicNodeMaterial();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let loaded: THREE.Group | null = null;
    await renderScene(
      <Model
        kit={kit}
        onLoad={(o) => (loaded = o)}
        materials={{ wheels: "rubber", shell: custom, ruota_ant_dx: "chrome", door: "gold" }}
      />,
    );
    await waitFor(() => expect(loaded).not.toBeNull());
    const model = loaded as unknown as THREE.Group;
    await waitFor(() => expect(meshNamed(model, "carrozzeria").material).toBe(custom));
    expect((meshNamed(model, "ruota_ant_sx").material as THREE.Material).name).toBe("rubber");
    // Later entries win.
    expect((meshNamed(model, "ruota_ant_dx").material as THREE.Material).name).toBe("chrome");
    expect(warn).toHaveBeenCalledWith('[apricot] Material override "door" matches no part');
    warn.mockRestore();
  });

  it("needs a src or a kit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(renderScene(<Model />)).rejects.toThrow(/needs `src` or `kit`/);
    error.mockRestore();
  });
});

describe("useMaterial", () => {
  it("gives a preset material that follows live options and rebuilds for new presets", async () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    const seen: THREE.Material[] = [];
    function Box({ preset, color }: { preset: string; color: string }) {
      const material = useMaterial(preset, { color, transition: 0.1 });
      seen.push(material);
      mesh.material = material;
      return <Primitive object={mesh} />;
    }
    const view = await renderScene(<Box preset="gold" color="#ffcc00" />);
    const first = seen.at(-1) as THREE.MeshPhysicalNodeMaterial;
    expect(first.name).toBe("gold");
    const disposeFirst = vi.spyOn(first, "dispose");
    // A new colour gives the material for the new values, animated from the old colour, and frees the old one.
    view.update(<Box preset="gold" color="#00ff00" />);
    const green = seen.at(-1) as THREE.MeshPhysicalNodeMaterial;
    expect(green).not.toBe(first);
    expect(disposeFirst).toHaveBeenCalled();
    await stepFrames(2, 16);
    expect(green.color.getHexString()).not.toBe("00ff00");
    await stepFrames(20, 16);
    expect(green.color.getHexString()).toBe("00ff00");
    const dispose = vi.spyOn(green, "dispose");
    view.update(<Box preset="chrome" color="#00ff00" />);
    await stepFrames(1);
    expect((seen.at(-1) as THREE.Material).name).toBe("chrome");
    expect(dispose).toHaveBeenCalled();
  });

  it("keys TSL nodes and textures in `physical` by identity, without serializing their images", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const art = new THREE.Texture({ width: 4, height: 4 });
    const cut = texture(art).a;
    const seen: THREE.Material[] = [];
    function Probe({ opacityNode }: { opacityNode: THREE.Node }) {
      seen.push(useMaterial("paint", { physical: { opacityNode } as object }));
      return null;
    }
    const view = await renderScene(<Probe opacityNode={cut} />);
    view.update(<Probe opacityNode={cut} />);
    expect(seen.at(-1)).toBe(seen[0]);
    expect((seen[0] as THREE.MeshPhysicalNodeMaterial).opacityNode).toBe(cut);
    // A different node gives a different material.
    view.update(<Probe opacityNode={texture(art).r} />);
    expect(seen.at(-1)).not.toBe(seen[0]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("serialize");
    warn.mockRestore();
  });

  it("shares one material between components with the same preset and values", async () => {
    const seen = new Map<string, THREE.Material>();
    function Probe({ id, color }: { id: string; color: string }) {
      seen.set(id, useMaterial("matte", { color }));
      return null;
    }
    const before = sharedMaterialCount();
    const view = await renderScene(
      <>
        <Probe id="a" color="#a7abb2" />
        <Probe id="b" color="#a7abb2" />
        <Probe id="c" color="#ffffff" />
      </>,
    );
    expect(seen.get("a")).toBe(seen.get("b"));
    expect(seen.get("c")).not.toBe(seen.get("a"));
    expect(sharedMaterialCount() - before).toBe(2);
    // Sides and vertex colours make a different material.
    function Options({ id, ...options }: { id: string; side?: "double"; vertexColors?: boolean }) {
      seen.set(id, useMaterial("matte", { color: "#a7abb2", ...options }));
      return null;
    }
    const other = await renderScene(
      <>
        <Options id="double" side="double" />
        <Options id="painted" vertexColors />
      </>,
    );
    expect(seen.get("double")?.side).toBe(THREE.DoubleSide);
    expect(seen.get("painted")?.vertexColors).toBe(true);
    expect(new Set([seen.get("a"), seen.get("double"), seen.get("painted")]).size).toBe(3);
    other.update(null);
    const shared = seen.get("a") as THREE.Material;
    const dispose = vi.spyOn(shared, "dispose");
    // Kept, since "b" still uses it.
    view.update(
      <>
        <Probe id="b" color="#a7abb2" />
        <Probe id="c" color="#ffffff" />
      </>,
    );
    expect(dispose).not.toHaveBeenCalled();
    view.update(null);
    expect(dispose).toHaveBeenCalled();
    expect(sharedMaterialCount()).toBe(before);
  });
});
