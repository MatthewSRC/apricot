import { act, waitFor } from "@testing-library/react";
import { Platform } from "react-native";
import * as THREE from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGlb } from "../../../core/src/__tests__/glb";
import { defineModelKit, Model, type PartPressEvent } from "../Model";
import { renderScene, stepFrames } from "./render";
import { assetState, sharedValue } from "./setup";

const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  vi.restoreAllMocks();
});

/** Serves a model as bundled asset `id` and returns a promise for the loaded copy. */
const serve = (id: number, bytes: ArrayBuffer) => {
  (Platform as { OS: string }).OS = "ios";
  assetState.files.set(`file:///asset-${id}`, bytes);
};

const loaded = () => {
  const box: { object: THREE.Group | null } = { object: null };
  return { box, onLoad: (o: THREE.Group) => (box.object = o) };
};

const angleY = (o: THREE.Object3D) => new THREE.Euler().setFromQuaternion(o.quaternion).y;

/** View point of world point `p` in a scene's canvas. */
const screenOf = (
  scene: { camera: THREE.Camera; size: { width: number; height: number } },
  p: THREE.Vector3,
) => {
  const ndc = p.clone().project(scene.camera);
  return [((ndc.x + 1) / 2) * scene.size.width, ((1 - ndc.y) / 2) * scene.size.height] as const;
};

describe("<Model joints>", () => {
  it("opens a kit joint, animates plain value changes and resets on removal", async () => {
    serve(61, makeGlb(["base", "lid"]));
    const kit = defineModelKit(61, {
      lid: { select: "lid", hinge: "left", axis: "y", range: [0, 90], transition: 0.2 },
    });
    const { box, onLoad } = loaded();
    const view = await renderScene(<Model kit={kit} onLoad={onLoad} joints={{ lid: 1 }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    const lid = box.object?.getObjectByName("lid") as THREE.Object3D;
    await stepFrames(2);
    // Starts open, since the first value does not animate.
    expect(angleY(lid)).toBeCloseTo(Math.PI / 2, 4);

    view.update(<Model kit={kit} onLoad={onLoad} joints={{ lid: 0 }} />);
    await stepFrames(6, 16);
    const midway = angleY(lid);
    expect(midway).toBeGreaterThan(0.01);
    expect(midway).toBeLessThan(Math.PI / 2 - 0.01);
    await stepFrames(20, 16);
    expect(angleY(lid)).toBeCloseTo(0, 5);

    view.update(<Model kit={kit} onLoad={onLoad} joints={{ lid: 1 }} />);
    await stepFrames(30, 16);
    expect(angleY(lid)).toBeCloseTo(Math.PI / 2, 4);
    view.update(<Model kit={kit} onLoad={onLoad} />);
    await stepFrames(1);
    expect(lid.position.x).toBeCloseTo(1, 5);
    expect(angleY(lid)).toBe(0);
  });

  it("follows shared values exactly and takes the joint inline", async () => {
    serve(62, makeGlb(["base", "drawer"]));
    const { box, onLoad } = loaded();
    const open = sharedValue(0);
    await renderScene(
      <Model
        src={62}
        onLoad={onLoad}
        joints={{ "node:drawer": { value: open as never, slide: [0, 2], axis: "x" } }}
      />,
    );
    await waitFor(() => expect(box.object).not.toBeNull());
    const drawer = box.object?.getObjectByName("drawer") as THREE.Object3D;
    await stepFrames(1);
    expect(drawer.position.x).toBeCloseTo(1, 5);
    await act(async () => {
      open.value = 0.5;
    });
    await stepFrames(1);
    expect(drawer.position.x).toBeCloseTo(2, 5);
  });

  it("uses the key as selector and default hinge, and warns when nothing matches", async () => {
    serve(63, makeGlb(["door"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { box, onLoad } = loaded();
    await renderScene(<Model src={63} onLoad={onLoad} joints={{ door: 0.5, missing: 1 }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    await stepFrames(2);
    const door = box.object?.getObjectByName("door") as THREE.Object3D;
    expect(angleY(door)).toBeCloseTo(Math.PI / 4, 4);
    expect(warn).toHaveBeenCalledWith('[apricot] Joint "missing" matches no part');
  });
});

describe("<Model animations>", () => {
  // "lid" rises from y 0 to y 2 over 1 second.
  const animated = () =>
    makeGlb(["lid"], undefined, { name: "Open", node: 0, times: [0, 1], translations: [0, 0, 0, 0, 2, 0] });

  it("scrubs a clip to a progress, animating plain changes", async () => {
    serve(71, animated());
    const { box, onLoad } = loaded();
    const view = await renderScene(<Model src={71} onLoad={onLoad} animations={{ Open: 0.5 }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    const lid = box.object?.getObjectByName("lid") as THREE.Object3D;
    await stepFrames(1);
    expect(lid.position.y).toBeCloseTo(1, 4);
    view.update(<Model src={71} onLoad={onLoad} animations={{ Open: 1 }} />);
    await stepFrames(60, 16);
    expect(lid.position.y).toBeCloseTo(2, 4);
  });

  it("plays a clip once or on repeat", async () => {
    serve(72, animated());
    const { box, onLoad } = loaded();
    const view = await renderScene(<Model src={72} onLoad={onLoad} animations={{ Open: "once" }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    const lid = box.object?.getObjectByName("lid") as THREE.Object3D;
    await stepFrames(30, 16);
    expect(lid.position.y).toBeGreaterThan(0.5);
    await stepFrames(60, 16);
    expect(lid.position.y).toBeCloseTo(2, 4);
    view.update(<Model src={72} onLoad={onLoad} animations={{ Open: "loop" }} />);
    await stepFrames(70, 16);
    // The loop wraps around past the start.
    expect(lid.position.y).toBeLessThan(1.9);
  });

  it("ignores animations on models without clips", async () => {
    serve(73, makeGlb(["lid"]));
    const { box, onLoad } = loaded();
    await renderScene(<Model src={73} onLoad={onLoad} animations={{ Open: 1 }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    await stepFrames(2);
    expect(box.object?.getObjectByName("lid")?.position.y).toBe(0);
  });
});

describe("<Model onPartPress>", () => {
  it("reports taps with kit names, joints first", async () => {
    serve(81, makeGlb(["door", "wheel"]));
    const kit = defineModelKit(81, {
      shell: "*",
      door: { select: "door", hinge: "left" },
      wheel: "wheel",
    });
    const { box, onLoad } = loaded();
    const onPartPress = vi.fn<(event: PartPressEvent<"shell" | "door" | "wheel">) => void>();
    const view = await renderScene(<Model kit={kit} onLoad={onLoad} onPartPress={onPartPress} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    const [x, y] = screenOf(view.scene, new THREE.Vector3(0.2, 0.2, 0));
    expect(view.scene.press(x, y)?.mesh.name).toBe("door");
    expect(onPartPress).toHaveBeenCalledWith(
      expect.objectContaining({ part: "door", parts: ["door", "shell"], name: "door" }),
    );
    const [wx, wy] = screenOf(view.scene, new THREE.Vector3(1.2, 0.2, 0));
    view.scene.press(wx, wy);
    // The most specific name wins over the catch-all.
    expect(onPartPress).toHaveBeenLastCalledWith(
      expect.objectContaining({ part: "wheel", parts: ["wheel", "shell"] }),
    );
    // Removing the handler stops listening.
    view.update(<Model kit={kit} onLoad={onLoad} />);
    expect(view.scene.presses.active).toBe(false);
  });

  it("reports mesh names without a kit", async () => {
    serve(82, makeGlb(["body"]));
    const { box, onLoad } = loaded();
    const onPartPress = vi.fn();
    const view = await renderScene(<Model src={82} onLoad={onLoad} onPartPress={onPartPress} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    view.scene.press(...screenOf(view.scene, new THREE.Vector3(0.2, 0.2, 0)));
    expect(onPartPress).toHaveBeenCalledWith(
      expect.objectContaining({ part: undefined, parts: [], name: "body" }),
    );
  });
});

describe("<Model inspect>", () => {
  it("highlights the tapped part and shows its name and material", async () => {
    serve(91, makeGlb(["Body_Hood"]));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const kit = defineModelKit(91, { hood: { select: "Body_Hood", hinge: "front" } });
    const { box, onLoad } = loaded();
    const view = await renderScene(
      <Model kit={kit} onLoad={onLoad} inspect materials={{ hood: "chrome" }} />,
    );
    await waitFor(() => expect(box.object).not.toBeNull());
    const hood = box.object?.getObjectByName("Body_Hood") as THREE.Mesh;
    await waitFor(() => expect((hood.material as THREE.Material).name).toBe("chrome"));
    await act(async () => {
      view.scene.press(...screenOf(view.scene, new THREE.Vector3(0.2, 0.2, 0)));
    });
    expect(view.getByText("Body_Hood")).toBeTruthy();
    expect(view.getByText("kit: hood")).toBeTruthy();
    expect(view.getByText("1 triangles")).toBeTruthy();
    // The material name from the file, as selectors match it, and the preset that replaced it.
    expect(view.getByText("material: (unnamed) → chrome")).toBeTruthy();
    expect(hood.getObjectByName("apricot:inspect")).toBeDefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('part "Body_Hood" (node:Body_Hood)'));
    // Turning inspect off removes the highlight.
    view.update(<Model kit={kit} onLoad={onLoad} materials={{ hood: "chrome" }} />);
    expect(hood.getObjectByName("apricot:inspect")).toBeUndefined();
  });

  it("shows the path of nested, unnamed parts", async () => {
    serve(92, makeGlb(["body"]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { box, onLoad } = loaded();
    // Nest the mesh, unnamed, under a group named "Car".
    const nest = (o: THREE.Group) => {
      const mesh = o.getObjectByName("body") as THREE.Mesh;
      const car = new THREE.Group();
      car.name = "Car";
      o.add(car);
      car.add(mesh);
      mesh.name = "";
      (mesh.material as THREE.Material).name = "";
      onLoad(o);
    };
    const view = await renderScene(<Model src={92} onLoad={nest} inspect />);
    await waitFor(() => expect(box.object).not.toBeNull());
    await act(async () => {
      view.scene.press(...screenOf(view.scene, new THREE.Vector3(0.2, 0.2, 0)));
    });
    expect(view.getByText("(unnamed)")).toBeTruthy();
    expect(view.getByText("Car")).toBeTruthy();
    expect(view.getByText("material: (unnamed)")).toBeTruthy();
  });
});

describe("<Model morphs>", () => {
  const smiling = () =>
    makeGlb(["face"], undefined, undefined, { name: "Smile", offsets: [0, 1, 0, 0, 1, 0, 0, 1, 0] });

  it("drives shape keys by name, animating plain values, and resets them on removal", async () => {
    serve(101, smiling());
    const { box, onLoad } = loaded();
    const view = await renderScene(<Model src={101} onLoad={onLoad} morphs={{ Smile: 1 }} />);
    await waitFor(() => expect(box.object).not.toBeNull());
    const face = box.object?.getObjectByName("face") as THREE.Mesh;
    await stepFrames(2);
    expect(face.morphTargetInfluences?.[0]).toBe(1);
    view.update(<Model src={101} onLoad={onLoad} morphs={{ Smile: 0 }} />);
    await stepFrames(4, 16);
    const midway = face.morphTargetInfluences?.[0] as number;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    await stepFrames(40, 16);
    expect(face.morphTargetInfluences?.[0]).toBe(0);
    view.update(<Model src={101} onLoad={onLoad} morphs={{ Smile: 1 }} />);
    await stepFrames(40, 16);
    view.update(<Model src={101} onLoad={onLoad} />);
    expect(face.morphTargetInfluences?.[0]).toBe(0);
  });

  it("warns about unknown shape keys and lists them in the inspector", async () => {
    serve(102, smiling());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { box, onLoad } = loaded();
    const view = await renderScene(<Model src={102} onLoad={onLoad} morphs={{ Frown: 1 }} inspect />);
    await waitFor(() => expect(box.object).not.toBeNull());
    expect(warn).toHaveBeenCalledWith('[apricot] No shape key "Frown" in this model');
    await act(async () => {
      view.scene.press(...screenOf(view.scene, new THREE.Vector3(0.2, 0.2, 0)));
    });
    expect(view.getByText("shape keys: Smile")).toBeTruthy();
  });
});
