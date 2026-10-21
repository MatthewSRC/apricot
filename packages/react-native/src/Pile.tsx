import {
  type Bounds,
  type PileItem,
  Pile as PileSim,
  type SphereWorldOptions,
  visibleBox,
} from "@apricotjs/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { ParentContext, useParent } from "./parent";

export interface PileProps {
  /** How many objects to drop in total. */
  count: number;
  /** Seconds over which they drop (default 5). */
  duration?: number;
  /**
   * The area to fill. Default: what the camera sees, `depth` deep on each
   * side of z = 0, updated when the scene resizes. Objects enter from above
   * and pile up on its floor, so they never leave the screen.
   */
  bounds?: Bounds;
  /** Half the thickness of the default area (default 0.5). */
  depth?: number;
  /** Random size range (default [0.9, 1.1]). */
  scale?: readonly [number, number];
  /** Downward speed when objects appear (default 2). */
  speed?: number;
  /** Largest initial tumble in radians per second (default 4). */
  spin?: number;
  seed?: number;
  physics?: Omit<SphereWorldOptions, "capacity" | "bounds">;
  /** Called once everything has dropped and come to rest. The scene then stops rendering. */
  onSettled?: () => void;
  /**
   * What to drop. Each child is one kind of object and must be a mesh, such
   * as `<Apple />`. Children are templates: they are not drawn themselves and
   * their transforms are ignored. The collision radius is the mesh's
   * `userData.radius`, or else its bounding sphere's radius.
   */
  children: ReactNode;
}

const toItems = (templates: THREE.Object3D[]): PileItem[] =>
  templates.flatMap((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      console.warn(`[apricot] <Pile> drops meshes only; ignoring "${object.name || object.type}"`);
      return [];
    }
    let radius = mesh.userData.radius as number | undefined;
    if (radius === undefined) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      radius = (mesh.geometry.boundingSphere as THREE.Sphere).radius;
    }
    return [{ geometry: mesh.geometry, material: mesh.material, radius }];
  });

const sameItems = (a: PileItem[], b: PileItem[]) =>
  a.length === b.length &&
  a.every(
    (item, i) =>
      item.geometry === b[i].geometry && item.material === b[i].material && item.radius === b[i].radius,
  );

/**
 * Drops `count` copies of its children from above the screen over
 * `duration` seconds; they bounce, roll and pile up at the bottom. Each kind
 * of child is drawn in one call. The scene stops rendering once the pile has
 * settled.
 *
 *   <Pile count={50} duration={5}><Apple /></Pile>
 */
export function Pile({
  count,
  duration,
  bounds,
  depth = 0.5,
  scale,
  speed,
  spin,
  seed,
  physics,
  onSettled,
  children,
}: PileProps) {
  const scene = useScene();
  const parent = useParent();
  // Children attach to a group that is never added to the scene.
  const [templates] = useState(() => new THREE.Group());
  const [items, setItems] = useState<PileItem[]>([]);
  const pile = useRef<PileSim | null>(null);
  const settled = useRef(false);
  const latest = useRef({ onSettled, bounds, depth });
  latest.current = { onSettled, bounds, depth };

  useEffect(() => {
    const collect = () =>
      setItems((current) => {
        const next = toItems(templates.children);
        return sameItems(current, next) ? current : next;
      });
    collect();
    templates.addEventListener("childadded", collect);
    templates.addEventListener("childremoved", collect);
    return () => {
      templates.removeEventListener("childadded", collect);
      templates.removeEventListener("childremoved", collect);
    };
  }, [templates]);

  const area = () => latest.current.bounds ?? visibleBox(scene.camera, latest.current.depth);

  // Options are compared by value, so inline arrays and objects do not restart the pile.
  const config = JSON.stringify({ count, duration, depth, scale, speed, spin, seed, physics });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `config` stands for the options it serialises
  useEffect(() => {
    if (items.length === 0) return;
    const sim = new PileSim({ items, count, duration, bounds: area(), scale, speed, spin, seed, physics });
    parent.add(sim.object);
    pile.current = sim;
    settled.current = false;
    const offResize = scene.onResize(() => {
      if (!latest.current.bounds) sim.setBounds(area());
    });
    scene.invalidate();
    return () => {
      offResize();
      sim.dispose();
      pile.current = null;
      scene.invalidate();
    };
  }, [items, config, parent, scene]);

  // New explicit bounds move the walls without restarting.
  const boundsKey = JSON.stringify(bounds ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `boundsKey` stands for `bounds`
  useEffect(() => {
    if (bounds && pile.current) {
      pile.current.setBounds(bounds);
      settled.current = false;
      scene.invalidate();
    }
  }, [boundsKey, scene]);

  useFrame(({ delta }) => {
    const sim = pile.current;
    if (!sim) return false;
    const moving = sim.step(delta);
    if (moving) settled.current = false;
    else if (!settled.current) {
      settled.current = true;
      latest.current.onSettled?.();
    }
    return moving;
  });

  return <ParentContext.Provider value={templates}>{children}</ParentContext.Provider>;
}
