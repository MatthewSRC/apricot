import { Box, Group, type SceneObject } from "@apricotjs/react-native";
import { useState } from "react";
import type * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { renderScene, stepFrames } from "../../../react-native/src/__tests__/render";
import {
  Apple,
  Backdrop,
  Car,
  Card,
  Coin,
  ContactShadow,
  Ground,
  MoneyStack,
  Peach,
  StudioFloor,
  Trees,
} from "../components";

describe("<MoneyStack>", () => {
  it("adds a stack, rebuilds it when options change and disposes the old one", async () => {
    const view = await renderScene(<MoneyStack bills={5} position={[0, 1, 0]} />);
    const first = view.scene.scene.getObjectByName("MoneyStack") as THREE.Group;
    expect(first).toBeDefined();
    await stepFrames();
    expect(first.position.y).toBe(1);
    const bills = first.getObjectByName("MoneyStack:bills") as THREE.InstancedMesh;
    const dispose = vi.spyOn(bills.geometry, "dispose");
    view.update(<MoneyStack bills={6} colors={{ base: "#00ff00" }} />);
    const second = view.scene.scene.getObjectByName("MoneyStack") as THREE.Group;
    expect(second).not.toBe(first);
    expect((second.getObjectByName("MoneyStack:bills") as THREE.InstancedMesh).count).toBe(6);
    expect(dispose).toHaveBeenCalled();
  });
});

describe("<Coin>", () => {
  it("adds a coin and disposes it on unmount", async () => {
    const view = await renderScene(<Coin radius={0.3} />);
    const coin = view.scene.scene.getObjectByName("Coin") as THREE.Mesh;
    expect(coin).toBeDefined();
    const dispose = vi.spyOn(coin.geometry, "dispose");
    view.unmount();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("<Peach>", () => {
  it("adds a peach and disposes it when it changes or unmounts", async () => {
    const view = await renderScene(<Peach size={1.2} />);
    const peach = view.scene.scene.getObjectByName("Peach") as THREE.Group;
    expect(peach.scale.x).toBe(1.2);
    const skin = peach.children[0] as THREE.Mesh;
    const dispose = vi.spyOn(skin.geometry, "dispose");
    view.update(<Peach size={1.2} detail={0.2} leaves={false} />);
    expect(dispose).toHaveBeenCalled();
    view.unmount();
  });
});

describe("<Apple>", () => {
  it("adds an apple, works as a <Pile> item and disposes it on unmount", async () => {
    const { Pile } = await import("@apricotjs/react-native");
    const view = await renderScene(<Apple position={[0, 1, 0]} />);
    const apple = view.scene.scene.getObjectByName("Apple") as THREE.Mesh;
    expect(apple).toBeDefined();
    const dispose = vi.spyOn(apple.geometry, "dispose");
    view.update(
      <Pile count={3} duration={0.1}>
        <Apple size={0.6} />
      </Pile>,
    );
    expect(dispose).toHaveBeenCalled();
    await stepFrames(60, 50);
    const pile = view.scene.scene.getObjectByName("Pile") as THREE.Group;
    expect((pile.children[0] as THREE.InstancedMesh).count).toBe(3);
    // Collides as a sphere of the apple's radius.
    expect((view.scene.scene.getObjectByName("Apple") as THREE.Mesh | undefined)?.parent ?? null).toBeNull();
    view.unmount();
  });
});

describe("driving scenery components", () => {
  it("adds a car, trees, ground and a contact shadow, rebuilding and disposing them", async () => {
    const view = await renderScene(
      <>
        <Car />
        <Trees count={4} />
        <Ground size={10} />
        <ContactShadow width={2} />
      </>,
    );
    for (const name of ["Car", "Trees", "Ground", "ContactShadow"]) {
      expect(view.scene.scene.getObjectByName(name)).toBeDefined();
    }
    const firstCar = view.scene.scene.getObjectByName("Car");
    view.update(
      <>
        <Car color="#00f" />
        <Trees count={4} />
        <Ground size={10} />
        <ContactShadow width={2} />
      </>,
    );
    expect(view.scene.scene.getObjectByName("Car")).not.toBe(firstCar);
    const ground = view.scene.scene.getObjectByName("Ground") as THREE.Mesh;
    const dispose = vi.spyOn(ground.geometry, "dispose");
    view.unmount();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("<Card>", () => {
  it("adds a card and swaps finishes without rebuilding it", async () => {
    const view = await renderScene(<Card finish="gold" />);
    const card = view.scene.scene.getObjectByName("Card") as THREE.Group;
    expect(card.userData.finish).toBe("gold");
    view.update(<Card finish="chrome" />);
    expect(view.scene.scene.getObjectByName("Card")).toBe(card);
    expect(card.userData.finish).toBe("chrome");
    view.update(<Card />);
    expect(card.userData.finish).toBe("brushed-steel");
    const dispose = vi.spyOn((card.getObjectByName("Card:body") as THREE.Mesh).geometry, "dispose");
    view.unmount();
    expect(dispose).toHaveBeenCalled();
  });
});

describe("<Backdrop>", () => {
  it("adds a backdrop and rebuilds it for new colours", async () => {
    const view = await renderScene(<Backdrop position={[0, 0, -3]} />);
    const first = view.scene.scene.getObjectByName("Backdrop");
    expect(first).toBeDefined();
    view.update(<Backdrop colors={["#000", "#111"]} position={[0, 0, -3]} />);
    expect(view.scene.scene.getObjectByName("Backdrop")).not.toBe(first);
    view.unmount();
  });
});

describe("<StudioFloor>", () => {
  it("adds a floor and rebuilds it when its colours change", async () => {
    const view = await renderScene(<StudioFloor />);
    const first = view.scene.scene.getObjectByName("StudioFloor");
    expect(first).toBeDefined();
    view.update(<StudioFloor colors={["#000", "#111"]} />);
    expect(view.scene.scene.getObjectByName("StudioFloor")).not.toBe(first);
  });
});

describe("<ContactShadow under>", () => {
  it("sizes itself to what it is under, lies at its base, and leaves itself out of it", async () => {
    function Stand({ size }: { size: [number, number, number] }) {
      const [piece, setPiece] = useState<SceneObject | null>(null);
      return (
        <Group ref={setPiece} position={[1, 0, 0]}>
          <Box size={size} position={[0, size[1] / 2 + 0.5, 0]} />
          <ContactShadow under={piece} spread={1} />
        </Group>
      );
    }
    const view = await renderScene(<Stand size={[0.2, 0.3, 0.1]} />);
    await stepFrames(3);
    const shadow = view.scene.scene.getObjectByName("ContactShadow") as THREE.Mesh;
    // A mug: as big as the mug, under it (in the group's own space), not grown by itself.
    expect(shadow.scale.x).toBeCloseTo(0.2);
    expect(shadow.scale.z).toBeCloseTo(0.1);
    expect(shadow.position.x).toBeCloseTo(0);
    expect(shadow.position.y).toBeCloseTo(0.5, 2);
    // A sofa: the same shadow, sized again.
    view.update(<Stand size={[2, 0.8, 0.9]} />);
    await stepFrames(3);
    expect(shadow.scale.x).toBeCloseTo(2);
    expect(shadow.scale.z).toBeCloseTo(0.9);
    view.unmount();
  });
});
