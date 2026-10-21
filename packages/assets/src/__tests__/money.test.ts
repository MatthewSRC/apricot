import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { createBanknoteMaterial, createCoin, createMoneyStack } from "../money";

describe("createMoneyStack", () => {
  it("draws all bills as one instanced mesh plus a band", () => {
    const stack = createMoneyStack({ bills: 25 });
    const bills = stack.getObjectByName("MoneyStack:bills") as THREE.InstancedMesh;
    expect(bills).toBeInstanceOf(THREE.InstancedMesh);
    expect(bills.count).toBe(25);
    expect(stack.getObjectByName("MoneyStack:band")).toBeInstanceOf(THREE.Mesh);
  });

  it("stacks upwards from y = 0 with a band as tall as the stack", () => {
    const stack = createMoneyStack({ bills: 10, thickness: 0.02 });
    const bills = stack.getObjectByName("MoneyStack:bills") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    bills.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).y).toBeCloseTo(0.01);
    bills.getMatrixAt(9, m);
    expect(p.setFromMatrixPosition(m).y).toBeCloseTo(0.02 * 1.02 * 9 + 0.01);
    const band = stack.getObjectByName("MoneyStack:band") as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(band);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(0.02 * 1.02 * 10 + 0.01);
  });

  it("makes the band wide enough that no bill pokes through it", () => {
    const stack = createMoneyStack({ bills: 200, seed: 7 });
    const bills = stack.getObjectByName("MoneyStack:bills") as THREE.InstancedMesh;
    const band = new THREE.Box3().setFromObject(stack.getObjectByName("MoneyStack:band") as THREE.Mesh);
    const m = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    for (let i = 0; i < bills.count; i++) {
      bills.getMatrixAt(i, m);
      // Corners of the bill where it passes under the band's left and right edges.
      for (const x of [band.min.x, band.max.x]) {
        for (const z of [-1.05 / 2, 1.05 / 2]) {
          corner.set(x, 0, z).applyMatrix4(m);
          expect(Math.abs(corner.z)).toBeLessThan(band.max.z);
        }
      }
    }
  });

  it("is reproducible for a seed", () => {
    const matrices = (seed: number) =>
      Array.from(
        (createMoneyStack({ seed }).getObjectByName("MoneyStack:bills") as THREE.InstancedMesh).instanceMatrix
          .array,
      );
    expect(matrices(3)).toEqual(matrices(3));
    expect(matrices(3)).not.toEqual(matrices(4));
  });

  it("supports no band, a band colour and at least one bill", () => {
    expect(createMoneyStack({ band: false }).getObjectByName("MoneyStack:band")).toBeUndefined();
    const band = createMoneyStack({ band: "#ff0000" }).getObjectByName("MoneyStack:band") as THREE.Mesh;
    expect((band.material as THREE.MeshStandardNodeMaterial).color.getHexString()).toBe("ff0000");
    const bills = createMoneyStack({ bills: 0 }).getObjectByName("MoneyStack:bills") as THREE.InstancedMesh;
    expect(bills.count).toBe(1);
  });
});

describe("createBanknoteMaterial", () => {
  it("is a node material with a colour node", () => {
    const material = createBanknoteMaterial(2, { base: "#000000" });
    expect(material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(material.colorNode).toBeTruthy();
  });
});

describe("createCoin", () => {
  it("is a flat cylinder with a node material", () => {
    const coin = createCoin({ radius: 1, thickness: 0.1 });
    expect(coin.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect((coin.geometry as THREE.CylinderGeometry).parameters).toMatchObject({ radiusTop: 1, height: 0.1 });
    expect((coin.material as THREE.MeshStandardNodeMaterial).colorNode).toBeTruthy();
    expect(createCoin().name).toBe("Coin");
  });
});
