import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  CARD_FINISHES,
  CARD_SIZE,
  type CardFinish,
  createCard,
  createCardMaterials,
  setCardFinish,
} from "../card";

const body = (card: THREE.Object3D) => card.getObjectByName("Card:body") as THREE.Mesh;

describe("createCard", () => {
  it("is card sized, centred, front facing +z, with a chip on the front", () => {
    const card = createCard();
    const box = new THREE.Box3().setFromObject(body(card));
    expect(box.max.x - box.min.x).toBeCloseTo(CARD_SIZE.width, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(CARD_SIZE.height, 3);
    expect(box.max.z - box.min.z).toBeCloseTo(CARD_SIZE.thickness, 3);
    expect(box.max.z).toBeCloseTo(CARD_SIZE.thickness / 2, 3);
    const chip = card.getObjectByName("Card:chip") as THREE.Mesh;
    expect(chip.position.z).toBeGreaterThan(CARD_SIZE.thickness / 2);
    expect(chip.position.x).toBeLessThan(0);
    // Drawn after see-through materials, so glass does not refract a ghost of it.
    expect((chip.material as THREE.Material).transparent).toBe(true);
    expect((chip.material as THREE.Material).opacity).toBe(1);
    expect(card.userData.finish).toBe("brushed-steel");
    expect(createCard({ chip: false }).getObjectByName("Card:chip")).toBeUndefined();
  });

  it("draws the chip after the glass from the front and before it from the back, at any angle", () => {
    // three sorts see-through objects by the depth of their bounding spheres' centres, nearest last.
    const card = createCard({ finish: "glass" });
    const chip = card.getObjectByName("Card:chip") as THREE.Mesh;
    const camera = new THREE.PerspectiveCamera(35, 0.5, 0.1, 100);
    const depth = (mesh: THREE.Mesh) => {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere as THREE.Sphere;
      return sphere.center.clone().applyMatrix4(mesh.matrixWorld).project(camera).z;
    };
    for (let turn = -80; turn <= 260; turn += 10) {
      for (const tilt of [-30, 0, 30]) {
        card.rotation.set(THREE.MathUtils.degToRad(tilt), THREE.MathUtils.degToRad(turn), 0);
        card.updateMatrixWorld(true);
        // Off to one side too, as when the card sits left of the screen's centre.
        camera.position.set(1.5, 0.5, 6);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(card.quaternion);
        const seesFront = front.dot(camera.position) > 0;
        if (Math.abs(front.dot(camera.position.clone().normalize())) < 0.05) continue; // edge on
        const chipNearer = depth(chip) < depth(body(card));
        expect(chipNearer).toBe(seesFront);
      }
    }
    // The sphere still holds the whole chip (for culling and taps).
    chip.geometry.computeBoundingBox();
    const box = chip.geometry.boundingBox as THREE.Box3;
    const sphere = chip.geometry.boundingSphere as THREE.Sphere;
    for (const corner of [box.min, box.max, new THREE.Vector3(box.min.x, box.max.y, box.max.z)])
      expect(sphere.containsPoint(corner)).toBe(true);
  });

  it("uses the face material for front and back, and the edge material for the sides", () => {
    const card = createCard({ finish: "gold" });
    const mesh = body(card);
    const materials = mesh.material as THREE.MeshPhysicalNodeMaterial[];
    expect(materials).toHaveLength(2);
    expect(mesh.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(materials[0].metalness).toBe(1);
  });
});

describe("finishes", () => {
  it("covers metals, rough and lacquered dielectrics, and glass", () => {
    const finishes = Object.keys(CARD_FINISHES) as CardFinish[];
    expect(finishes).toEqual([
      "brushed-steel",
      "chrome",
      "gold",
      "rose-gold",
      "matte-black",
      "glossy-paint",
      "glass",
    ]);
    for (const finish of finishes) {
      const { face, edge } = createCardMaterials(finish);
      expect(face).toBeInstanceOf(THREE.MeshPhysicalNodeMaterial);
      expect(face.colorNode).not.toBeNull();
      expect(face.roughnessNode).not.toBeNull();
      expect(edge).not.toBe(face);
    }
    expect(createCardMaterials("brushed-steel").face.anisotropy).toBeGreaterThan(0);
    expect(createCardMaterials("chrome").face.anisotropy).toBe(0);
    expect(createCardMaterials("glossy-paint").face.clearcoat).toBe(1);
    const glass = createCardMaterials("glass", new THREE.Texture()).face;
    expect(glass.transmission).toBe(1);
    // Thick enough to visibly bend what is behind, and tinted.
    expect(glass.thickness).toBeGreaterThan(0.1);
    expect(glass.attenuationDistance).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(glass.transmissionNode).not.toBeNull();
    // Laser-cut black coating shows bright steel; the coating itself is not pure black.
    expect(CARD_FINISHES["matte-black"].engraving.metalness).toBe(1);
    expect(
      new THREE.Color(CARD_FINISHES["matte-black"].color).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
        .l,
    ).toBeGreaterThan(0.1);
  });

  it("engraves the art on the front only", () => {
    const art = new THREE.Texture();
    const { face, edge } = createCardMaterials("chrome", art);
    expect(face.colorNode).not.toBe(edge.colorNode);
  });

  it("switches finish in place and disposes the old materials", () => {
    const card = createCard({ finish: "chrome" });
    const old = body(card).material as THREE.Material[];
    const dispose = vi.spyOn(old[0], "dispose");
    setCardFinish(card, "glass", new THREE.Texture());
    expect(dispose).toHaveBeenCalled();
    expect((body(card).material as THREE.MeshPhysicalNodeMaterial[])[0].transmission).toBe(1);
    expect(card.userData.finish).toBe("glass");
    expect(() => setCardFinish(new THREE.Group(), "gold")).toThrow(/createCard/);
  });
});
