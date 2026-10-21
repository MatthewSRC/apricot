import {
  alongWall,
  covers,
  floorPoint,
  hangOn,
  snap,
  snapTurn,
  type TouchPoint,
  twist,
  type Wall,
  wallPoint,
} from "@apricotjs/core";
import { type RefObject, useRef } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "../context";
import { useSceneTouches } from "../touches";
import { allowed, apart, hungOn, overlapsAt, overlapsOnWall, settle, supportOf } from "./checks";
import { carried } from "./geometry";
import { type FitState, type Item, type Measured, placedOf, placeOf, topOf, xyz } from "./item";
import { confine, levelAt, levelOver, roam, type Space, snapTo } from "./space";
import type { Place, PlaceChange } from "./types";
import { wallOfHung } from "./walls";

interface At {
  x: number;
  y: number;
  z: number;
  turn: number;
}
const placeAt = ({ x, y, z, turn }: At): Place => ({ position: [x, y, z], turn });
const atOf = ({ position: [x, y, z], turn }: Place): At => ({ x, y, z, turn });

/** The gesture on the selected object: one finger moves it, two turn it. */
export interface Drag {
  moving: Measured;
  others: Measured[];
  surfaces: Measured[];
  riders: { rider: Item; from: Place }[];
  /** Where the object was when the drag began. */
  start: Place;
  fingers: number;
  /** From the finger's point to the object's origin: (x, z) on its level, or (along, up) on its wall. */
  offset: [number, number];
  twistFrom: TouchPoint[];
  turnFrom: number;
  first: TouchPoint;
  /** The farthest the first finger moved from where it went down, in points. */
  moved: number;
  place: At;
  /** Whether it fits at `place`. */
  fits: boolean;
  /** The last place where it fitted. It returns there if released where it does not fit. */
  good: At;
  wall: Wall | null;
}

export interface DragOptions {
  items: Map<string, Item>;
  /** The latest rules, and the id of the selected object. */
  latest: RefObject<Space & { selected: string | null }>;
  placed: () => Measured[];
  fit: RefObject<FitState>;
  setFits: (id: string, fits: boolean) => void;
  commit: (item: Item, place: Place, by: PlaceChange["by"]) => void;
  /** The marker's holder: a finger on it also grabs the selected object. */
  marker: THREE.Object3D;
}

/** Offset from the point `hit` on a wall to an origin at (x, y, z), as (along, up). */
const wallOffset = (hit: { wall: Wall; point: THREE.Vector3 }, x: number, y: number, z: number) =>
  [alongWall(hit.wall, x, z) - alongWall(hit.wall, hit.point.x, hit.point.z), y - hit.point.y] as [
    number,
    number,
  ];

/** Drags the selected object by touch. Returns the current drag, or null when there is none. */
export function usePlacementDrag({
  items,
  latest,
  placed,
  fit,
  setFits,
  commit,
  marker,
}: DragOptions): RefObject<Drag | null> {
  const scene = useScene();
  const drag = useRef<Drag | null>(null);
  const point = new THREE.Vector3();
  const pointOn = (p: TouchPoint, level: number) =>
    floorPoint(scene.camera, p.x, p.y, scene.size.width, scene.size.height, level, point);
  const wallAt = (p: TouchPoint) => {
    const { walls } = latest.current;
    return walls.length
      ? // Slack keeps a finger dragged past the top of a wall on the wall.
        wallPoint(scene.camera, p.x, p.y, scene.size.width, scene.size.height, walls, { slack: 2 })
      : null;
  };

  /**
   * Where the finger at `p` points for an object held `offset` from it: on
   * the surface nearest the camera that would hold it there, else on the
   * floor at `floor`.
   */
  const standAt = (p: TouchPoint, surfaces: Measured[], offset: readonly [number, number], floor = 0) => {
    const eye = scene.camera.position;
    let best: { at: THREE.Vector3; support: Measured | null } | null = null;
    for (const support of surfaces) {
      const at = pointOn(p, topOf(support));
      if (!at || !covers(placedOf(support), at.x + offset[0], at.z + offset[1])) continue;
      if (!best || at.distanceTo(eye) < best.at.distanceTo(eye)) best = { at: at.clone(), support };
    }
    if (best) return best;
    const ground = pointOn(p, floor);
    return ground ? { at: ground.clone(), support: null } : null;
  };

  /** Starts moving `item` from the finger at `p`. Returns false if the finger points at nothing to move along. */
  const begin = (item: Item, p: TouchPoint) => {
    const all = placed();
    const moving = all.find((m) => m.item === item) as Measured;
    const { riders, others } = apart(moving, all);
    const surfaces = others.filter((m) => m.item.surface);
    const { position, turn } = item.shown;
    let offset: [number, number] = [0, 0];
    let wall: Wall | null = null;
    if (item.on === "wall") {
      wall = wallOfHung(latest.current.walls, [position.x, position.y, position.z], turn, moving.extent);
      const hit = wallAt(p);
      if (!hit) return false;
      offset = wallOffset(hit, position.x, position.y, position.z);
    } else {
      const at = pointOn(p, position.y);
      if (!at) return false;
      offset = [position.x - at.x, position.z - at.z];
    }
    const place = { x: position.x, y: position.y, z: position.z, turn };
    const fits = fit.current.id !== item.id || fit.current.fits;
    drag.current = {
      moving,
      others,
      surfaces,
      riders: riders.map((m) => ({ rider: m.item, from: placeOf(m.item) })),
      start: placeOf(item),
      fingers: 1,
      offset,
      twistFrom: [p],
      turnFrom: turn,
      first: p,
      moved: 0,
      place,
      fits,
      // Selected where it does not fit, it returns to where it last fitted if released in a bad place.
      good: fits ? { ...place } : atOf(item.fitted),
      wall,
    };
    item.held = true;
    for (const { rider } of drag.current.riders) rider.held = true;
    return true;
  };

  /**
   * Moves the drag to `place` and returns true, if it fits there or collide
   * is not "block". Otherwise it stays at the last place where it fitted.
   */
  const moveTo = (place: At, standingOn: string | null, overlapping: string[]) => {
    const d = drag.current;
    if (!d) return false;
    const { item } = d.moving;
    const fits = allowed(latest.current, d.moving, placeAt(place), standingOn, overlapping);
    if (!fits && latest.current.collide === "block") return false;
    d.place = place;
    d.fits = fits;
    if (fits) d.good = { ...place };
    setFits(item.id, fits);
    return true;
  };

  /** Shows the moved object, and what it carries, at the drag's place. */
  const show = () => {
    const d = drag.current;
    if (!d) return;
    const { x, y, z, turn } = d.place;
    d.moving.item.shown.position.set(x, y, z);
    d.moving.item.shown.turn = turn;
    const to: Place = { position: [x, y, z], turn };
    for (const { rider, from } of d.riders) {
      const next = carried(from, d.start, to);
      rider.shown.position.set(...next.position);
      rider.shown.turn = next.turn;
    }
    scene.invalidate();
  };

  /** Slides the drag along the wall under the finger. */
  const moveOnWall = (d: Drag, p: TouchPoint) => {
    const space = latest.current;
    const hit = wallAt(p);
    if (!hit) return;
    const others =
      space.collide === "block"
        ? hungOn(space, d.moving, hit.wall, d.others).map((m) => ({
            position: xyz(m.item),
            extent: m.extent,
          }))
        : [];
    const hung = hangOn(hit.wall, hit.point, d.offset, d.moving.extent, {
      grid: space.steps.grid ?? 0,
      others,
      was: hit.wall.index === d.wall?.index ? [d.place.x, d.place.y, d.place.z] : undefined,
    });
    if (!hung) return;
    const over = space.collide === "warn" ? overlapsOnWall(space, d.moving, hit.wall, hung, d.others) : [];
    if (!moveTo({ x: hung[0], y: hung[1], z: hung[2], turn: hit.wall.turn }, null, over)) return;
    d.wall = hit.wall;
    show();
  };

  /** Moves the drag on the ground or a surface with one finger, or turns it with two. */
  const moveOnGround = (d: Drag, points: TouchPoint[]) => {
    const space = latest.current;
    const { steps, collide } = space;
    const { item } = d.moving;
    const grid = steps.grid ?? 0;
    let { x, y, z, turn } = d.place;
    let support = item.on === "surface" ? supportOf(x, y, z, d.surfaces) : null;
    if (points.length >= 2) {
      // Fingers turning clockwise on screen turn it clockwise seen from above.
      turn = snapTurn(d.turnFrom - twist(d.twistFrom, points), steps.turn ?? 0);
    } else {
      // The floor level to move along: its own level, or the area's level below it when it is on a surface.
      const ground = support ? levelAt(space, item, d.place.x, d.place.z, 0) : d.place.y;
      const stand =
        item.on === "surface"
          ? standAt(points[0], d.surfaces, d.offset, ground)
          : { at: pointOn(points[0], ground)?.clone() ?? null, support: null };
      if (!stand?.at) return;
      support = stand.support;
      x = snap(stand.at.x + d.offset[0], grid);
      z = snap(stand.at.z + d.offset[1], grid);
      if (!support) [x, z, turn] = snapTo(space, item.id, x, z, turn);
      y = support ? topOf(support) : item.on === "surface" ? ground : d.start.position[1];
    }
    let free: [number, number] | null;
    if (collide === "block") {
      // Pushed out of the way back towards where it was, so it stops against what it meets.
      const from = support === supportOf(d.place.x, d.place.y, d.place.z, d.surfaces) ? d.place : undefined;
      free = settle(space, d.moving, x, z, turn, y, support, d.others, from);
    } else if (collide === "warn") {
      free = roam(space, d.moving, x, z, turn, support);
    } else {
      free = confine(space, d.moving, x, z, turn, support, d.place);
    }
    if (!free) return;
    // On the ground it takes the level of the area it is in, or with "warn" of whatever area it is over.
    if (!support)
      y =
        collide === "warn"
          ? levelOver(space, free[0], free[1], y)
          : levelAt(space, item, free[0], free[1], y);
    const over = collide === "warn" ? overlapsAt(d.moving, free[0], free[1], turn, y, support, d.others) : [];
    if (!moveTo({ x: free[0], y, z: free[1], turn }, support?.item.id ?? null, over)) return;
    show();
  };

  useSceneTouches({
    capture: (points) => {
      const id = latest.current.selected;
      const item = id === null ? undefined : items.get(id);
      if (!item || item.locked || points.length !== 1) return false;
      // The finger must land on the selected object or its marker, even with another object in front.
      const hit = scene.presses.hitTest(
        scene.camera,
        points[0].x,
        points[0].y,
        scene.size.width,
        scene.size.height,
        [...[...items.values()].map((i) => i.group), marker],
      );
      let owner: THREE.Object3D | null = hit?.mesh ?? null;
      while (owner && owner !== item.group && owner !== marker) owner = owner.parent;
      if (!owner) return false;
      return begin(item, points[0]);
    },
    touch: (points) => {
      const d = drag.current;
      if (!d) return;
      const { item } = d.moving;
      if (points.length !== d.fingers) {
        // When fingers are added or lifted, the gesture continues from the current place without a jump.
        d.fingers = points.length;
        d.turnFrom = d.place.turn;
        d.twistFrom = points;
        if (item.on === "wall") {
          const hit = wallAt(points[0]);
          if (hit) d.offset = wallOffset(hit, d.place.x, d.place.y, d.place.z);
        } else {
          const at = pointOn(points[0], d.place.y);
          if (at) d.offset = [d.place.x - at.x, d.place.z - at.z];
        }
      }
      d.moved = Math.max(d.moved, Math.hypot(points[0].x - d.first.x, points[0].y - d.first.y));
      if (item.on !== "wall") moveOnGround(d, points);
      // Objects on walls always face the room, so they move with one finger and do not turn.
      else if (points.length === 1) moveOnWall(d, points[0]);
    },
    release: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return 0;
      const { item } = d.moving;
      item.held = false;
      const to = placeAt(d.fits ? d.place : d.good);
      commit(item, to, "hand");
      item.fitted = to;
      for (const { rider, from } of d.riders) {
        rider.held = false;
        commit(rider, carried(from, d.start, to), "hand");
      }
      // Forces a new fit check at the place where it ended up.
      fit.current.key = "";
      scene.invalidate();
      return d.moved;
    },
  });

  return drag;
}
