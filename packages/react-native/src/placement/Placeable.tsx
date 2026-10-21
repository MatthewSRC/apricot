import type { Footprint } from "@apricotjs/core";
import { useContext, useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "../context";
import { useFrame } from "../hooks";
import { ParentContext, useAttach } from "../parent";
import { PlacementContext } from "./context";
import { shortestTurn, turnXZ } from "./geometry";
import type { Item } from "./item";
import type { PlaceableProps } from "./types";

/** Rate at which the shown place eases to its target, per second. It settles in about 0.15 s. */
const SETTLE = 18;
/** How much of the water's slope a floating object tilts with. */
const TILT = 0.7;

const goal = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();
const tilt = new THREE.Quaternion();

const footprintFrom = (footprint: PlaceableProps["footprint"]): Footprint | undefined =>
  footprint
    ? "minX" in footprint
      ? footprint
      : { minX: -footprint[0] / 2, maxX: footprint[0] / 2, minZ: -footprint[1] / 2, maxZ: footprint[1] / 2 }
    : undefined;

/** An object to place by hand inside a <Placement>. Tap it to select it. */
export function Placeable({
  id,
  position = [0, 0, 0],
  turn = 0,
  on = "floor",
  surface = false,
  solid = true,
  locked = false,
  findRoom = false,
  footprint,
  children,
}: PlaceableProps) {
  const placement = useContext(PlacementContext);
  if (!placement) throw new Error("<Placeable> must be inside a <Placement>");
  const scene = useScene();
  const [group] = useState(() => {
    const created = new THREE.Group();
    // At its place from the start, not at the origin until the first frame.
    created.position.set(...position);
    created.rotation.y = THREE.MathUtils.degToRad(turn);
    // Hidden until the Placement has checked where it fits.
    if (findRoom) created.visible = false;
    return created;
  });
  group.name = `Placeable:${id}`;
  const [item] = useState<Item>(() => ({
    id,
    group,
    locked,
    on,
    surface,
    solid,
    target: { position, turn },
    fitted: { position, turn },
    shown: { position: new THREE.Vector3(...position), turn },
    held: false,
    arriving: findRoom,
  }));
  Object.assign(item, { id, locked, on, surface, solid, footprint: footprintFrom(footprint) });
  // New props give a new target, except while a finger holds it.
  const [x, y, z] = position;
  useEffect(() => {
    if (item.held) return;
    item.target = { position: [x, y, z], turn };
    placement.changed();
    scene.invalidate();
  }, [item, scene, placement, x, y, z, turn]);

  useEffect(() => {
    placement.items.set(id, item);
    placement.changed();
    return () => {
      if (placement.items.get(id) === item) placement.items.delete(id);
      placement.changed();
    };
  }, [placement, id, item]);
  useEffect(
    () => scene.presses.add(group, () => !item.locked && !item.arriving && placement.select(item.id)),
    [scene, group, item, placement],
  );

  useAttach(group);
  // Shadows are paused while it moves or bobs, so the shadow map is redrawn when it starts and stops, not every frame.
  const resume = useRef<(() => void) | null>(null);
  useEffect(() => () => resume.current?.(), []);
  useFrame(({ delta }) => {
    const { shown, target } = item;
    let moving = item.held;
    if (!item.held) {
      const k = delta > 0 ? 1 - Math.exp(-delta * SETTLE) : 1;
      const [tx, ty, tz] = target.position;
      const gap = Math.hypot(tx - shown.position.x, ty - shown.position.y, tz - shown.position.z);
      const turnGap = shortestTurn(shown.turn, target.turn);
      if (gap < 1e-4 && Math.abs(turnGap) < 0.05) {
        shown.position.set(tx, ty, tz);
        shown.turn = target.turn;
      } else {
        shown.position.lerp(goal.set(tx, ty, tz), k);
        shown.turn += turnGap * k;
        moving = true;
      }
    }
    // A held object is lifted off its wall, or off what it stands on.
    const raised = item.held ? placement.lift() : 0;
    const [ix, iz] = item.on === "wall" ? turnXZ(0, raised, shown.turn) : [0, 0];
    group.position.set(
      shown.position.x + ix,
      shown.position.y + (item.on === "wall" ? 0 : raised),
      shown.position.z + iz,
    );
    group.rotation.set(0, THREE.MathUtils.degToRad(shown.turn), 0);
    const waves =
      item.on === "water" && !item.held ? placement.wavesAt(shown.position.x, shown.position.z) : null;
    const bobbing = waves !== null && waves.settings.height > 0;
    if (waves) {
      group.position.y += waves.heightAt(shown.position.x, shown.position.z);
      const [sx, sz] = waves.slopeAt(shown.position.x, shown.position.z);
      tilt.setFromUnitVectors(UP, normal.set(-sx * TILT, 1, -sz * TILT).normalize());
      group.quaternion.premultiply(tilt);
    }
    const still = !moving && !bobbing;
    if (!still && !resume.current) resume.current = scene.shadows?.pause(group) ?? null;
    else if (still && resume.current) {
      resume.current();
      resume.current = null;
    }
    return moving || bobbing;
  });

  return <ParentContext.Provider value={group}>{children}</ParentContext.Provider>;
}
