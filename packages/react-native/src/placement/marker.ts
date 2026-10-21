import { createMarker, type Extent } from "@apricotjs/core";
import { useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "../context";
import { useAttach } from "../parent";
import type { Item } from "./item";
import type { MarkerOptions, PlacementProps } from "./types";

/** How far the marker extends past the object on each side, in metres. */
const MARGIN = 0.12;
/** Size of the hidden marker. */
const HIDDEN: [number, number] = [0.001, 0.001];

const isMarkerOptions = (marker: unknown): marker is MarkerOptions =>
  typeof marker === "object" && marker !== null && !(marker as THREE.Color).isColor;

/** The `marker` prop as options, or null for no marker. */
export const markerLook = (marker: NonNullable<PlacementProps["marker"]>): MarkerOptions | null =>
  marker === false ? null : isMarkerOptions(marker) ? marker : { color: marker };

export interface MarkerPatch {
  holder: THREE.Group;
  marker: ReturnType<typeof createMarker>;
  shown: boolean;
}

/**
 * The marker under the selected object, attached to the scene. It is always
 * in the scene and hidden by opacity 0, so showing it does not change what a
 * <Bundle> records and its shader is compiled with the rest of the scene.
 * A tap on it counts as a tap on the selected object, not on empty space.
 */
export function useMarkerPatch(): MarkerPatch {
  const scene = useScene();
  const [patch] = useState(() => {
    const made = createMarker({ opacity: 0, size: HIDDEN });
    made.mesh.renderOrder = 1;
    const holder = new THREE.Group();
    holder.name = "Placement:marker";
    holder.add(made.mesh);
    // Exposed for tools and tests.
    holder.userData.marker = made;
    return { holder, marker: made, shown: false };
  });
  useEffect(() => () => patch.marker.dispose(), [patch]);
  useAttach(patch.holder);
  useEffect(() => scene.presses.add(patch.holder, () => {}), [scene, patch]);
  return patch;
}

export const hidePatch = (patch: MarkerPatch) => {
  if (patch.shown) patch.marker.set({ opacity: 0, size: HIDDEN });
  patch.shown = false;
};

const offset = new THREE.Vector3();

/** Shows the marker for `item` of `extent`: flat under it, or upright behind it on a wall. */
export const showPatch = (
  patch: MarkerPatch,
  look: MarkerOptions,
  item: Item,
  extent: Extent,
  fits: boolean,
) => {
  patch.shown = true;
  const { holder, marker } = patch;
  const { position, turn } = item.shown;
  const flat = item.on !== "wall";
  holder.position.copy(position);
  holder.rotation.set(0, THREE.MathUtils.degToRad(turn), 0);
  const plane = marker.mesh;
  const reach = 2 * (look.margin ?? MARGIN);
  const width = extent.maxX - extent.minX + reach;
  // Raised 4 mm off the floor, surface or wall it lies on.
  if (flat) {
    offset.set((extent.minX + extent.maxX) / 2, 0.004, (extent.minZ + extent.maxZ) / 2);
    plane.rotation.set(-Math.PI / 2, 0, 0);
  } else {
    offset.set((extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2, extent.minZ + 0.004);
    plane.rotation.set(0, 0, 0);
  }
  plane.position.copy(offset);
  marker.set({
    size: [width, (flat ? extent.maxZ - extent.minZ : extent.maxY - extent.minY) + reach],
    color: fits ? (look.color ?? "#4f8cff") : (look.blocked ?? "#ff5a4f"),
    opacity: look.opacity ?? 0.8,
    radius: look.radius ?? 0.06,
    outline: look.outline ?? 0,
  });
};
