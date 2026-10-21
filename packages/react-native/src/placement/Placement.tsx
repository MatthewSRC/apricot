import { type Extent, snapTurn } from "@apricotjs/core";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "../context";
import { useFrame } from "../hooks";
import { allowed, apart, fitsAt, isOutside, overlapsAt, ridersOf, settle, supportFor } from "./checks";
import { PlacementContext, type PlacementState } from "./context";
import { usePlacementDrag } from "./drag";
import { carried, samePlace } from "./geometry";
import { EMPTY, type FitState, type Item, type Measured, placeOf } from "./item";
import { hidePatch, markerLook, showPatch, useMarkerPatch } from "./marker";
import { useMeasure } from "./measure";
import { findFreePlace } from "./search";
import { confine, resolveSpace, wavesAt } from "./space";
import type { FreePlaceOptions, Place, PlaceChange, PlacementProps } from "./types";

/**
 * Objects to select, move and turn by hand, such as furniture in a room,
 * props on an island or accessories on a car. Tap an object to select it,
 * drag it to move it, twist two fingers to turn it, and tap empty space to
 * deselect it. Drags elsewhere still turn the camera (<CameraRig orbit>).
 *
 *   <Placement bounds={[-2, -2, 2, 2]} snap={{ grid: 0.1, turn: 15, wall: 0.1 }} onChange={(id, place) => save(id, place)}>
 *     <Placeable id="desk" position={layout.desk.position} turn={layout.desk.turn} surface>
 *       <Model src={require("./desk.glb")} />
 *     </Placeable>
 *     <Placeable id="lamp" on="surface" position={layout.lamp.position} turn={layout.lamp.turn}>…</Placeable>
 *     <Placeable id="frame" on="wall" position={layout.frame.position} turn={layout.frame.turn}>…</Placeable>
 *   </Placement>
 *
 * Solid objects do not overlap: a moved object slides along what it meets.
 * With collide="warn" it passes through with a red marker instead, and
 * returns if released there. canPlace adds your own rules. Objects on a
 * surface move with it. Places come from your state and go back to it
 * through onChange, so a layout is plain data to save, load or undo.
 */
export function Placement({
  bounds,
  wallHeight = 2.4,
  walls,
  areas,
  zones,
  snaps,
  snap: steps = {},
  selected,
  onSelect,
  onChange,
  onArrive,
  onOutside,
  lift = 0.03,
  collide = "block",
  canPlace,
  onFitChange,
  marker = "#4f8cff",
  ref,
  children,
}: PlacementProps) {
  const scene = useScene();
  const [items] = useState(() => new Map<string, Item>());
  const [own, setOwn] = useState<string | null>(null);
  const current = selected !== undefined ? selected : own;
  const settings = {
    ...resolveSpace({ bounds, wallHeight, walls, areas, zones, snaps, steps, collide, canPlace }),
    selected: current,
    onSelect,
    onChange,
    onArrive,
    onOutside,
    lift,
    onFitChange,
  };
  const latest = useRef(settings);
  latest.current = settings;
  // Bumped when an input that decides where objects fit changes, so the fit and outside checks run again.
  const ruleset = useRef({ inputs: [] as unknown[], version: 0 });
  const inputs = [bounds, wallHeight, walls, areas, zones, canPlace];
  if (inputs.some((input, i) => input !== ruleset.current.inputs[i]))
    ruleset.current = { inputs, version: ruleset.current.version + 1 };
  // Requests a frame so the outside check runs for the new space.
  const rulesVersion = ruleset.current.version;
  useEffect(() => {
    if (rulesVersion > 1) scene.invalidate();
  }, [scene, rulesVersion]);
  // Counts items added, removed and given new places.
  const changes = useRef(0);

  const [state] = useState<PlacementState>(() => ({
    items,
    changed: () => {
      changes.current++;
    },
    selected: () => latest.current.selected,
    lift: () => latest.current.lift,
    wavesAt: (x, z) => wavesAt(latest.current, x, z),
    select: (id) => {
      if (id === latest.current.selected) return;
      // Set before the next render, since a second tap may come first.
      latest.current.selected = id;
      setOwn(id);
      latest.current.onSelect?.(id);
      scene.invalidate();
    },
  }));

  const { measuring, measure, placed } = useMeasure(items);

  /** Puts `item` at `place` and reports it to onChange, if it moved. */
  const commit = (item: Item, place: Place, by: PlaceChange["by"]) => {
    if (samePlace(item.target, place)) return;
    // The item stays at this target until its props change.
    item.target = place;
    changes.current++;
    latest.current.onChange?.(item.id, place, { by });
  };

  /** Commits `to` for `item`, and the matching carried place for each of `riders`. */
  const commitWithRiders = (item: Item, riders: Measured[], to: Place, by: PlaceChange["by"]) => {
    const from = placeOf(item);
    commit(item, to, by);
    for (const rider of riders) commit(rider.item, carried(placeOf(rider.item), from, to), by);
  };

  // When an object that does not fit is deselected, it returns to where it last fitted, with what stands on it.
  const down = useRef(current);
  useEffect(() => {
    const was = down.current;
    down.current = current;
    if (was === null || was === current || fit.current.id !== was || fit.current.fits) return;
    const item = items.get(was);
    if (!item || latest.current.collide === "block") return;
    const all = placed();
    const riders = ridersOf(all.find((m) => m.item === item) as Measured, all);
    commitWithRiders(item, riders, item.fitted, "hand");
    Object.assign(fit.current, { id: null, fits: true, key: "" });
    scene.invalidate();
  });

  useEffect(() => scene.presses.addMiss(() => state.select(null)), [scene, state]);

  // Whether the selected object fits where it is or is being moved to.
  const fit = useRef<FitState>({ id: null, fits: true, key: "" });
  const setFits = (id: string, fits: boolean) => {
    const was = fit.current;
    // A newly selected object fits until found otherwise.
    if (was.id !== id) Object.assign(was, { id, fits: true, key: "" });
    if (was.fits === fits) return;
    was.fits = fits;
    latest.current.onFitChange?.(id, fits);
    scene.invalidate();
  };

  const patch = useMarkerPatch();
  const drag = usePlacementDrag({ items, latest, placed, fit, setFits, commit, marker: patch.holder });

  /** Checks whether `item` fits at its target. It is checked again only when its inputs change. */
  const checkAtRest = (item: Item, extent: Extent | null) => {
    const { target } = item;
    const { collide } = latest.current;
    // Include its size, so a model that loads after it was put down is checked again.
    const size = extent
      ? [extent.minX, extent.maxX, extent.minZ, extent.maxZ].map((v) => v.toFixed(3)).join()
      : "";
    const key = `${target.position.join()},${target.turn},${items.size},${collide},${size},${ruleset.current.version}`;
    if (fit.current.id === item.id && fit.current.key === key) return;
    const all = placed();
    const moving = all.find((m) => m.item === item);
    if (!moving) return;
    const fits = fitsAt(latest.current, moving, target, all);
    if (fits) item.fitted = target;
    setFits(item.id, fits);
    fit.current.key = key;
  };

  const freePlace = (options: FreePlaceOptions) =>
    findFreePlace(latest.current, options, options.id ? items.get(options.id) : undefined, measure, placed);

  /** Room for `item` nearest its target: at its turn, else a quarter turn round. On a wall, at its height. */
  const roomFor = (item: Item) => {
    const [x, y, z] = item.target.position;
    if (item.on === "wall") return freePlace({ id: item.id, near: [x, z], height: y });
    return (
      freePlace({ id: item.id, near: [x, z] }) ??
      freePlace({ id: item.id, near: [x, z], turn: snapTurn(item.target.turn + 90, 0) })
    );
  };

  const outsideNow = () => {
    const all = placed();
    return all.filter((m) => isOutside(latest.current, m, all)).map((m) => m.item.id);
  };

  /** Checks new <Placeable findRoom>s once measured, moves those that do not fit, and shows them. */
  const arrive = () => {
    for (const item of items.values()) {
      if (!item.arriving) continue;
      const moving = measure(item);
      // Its model is still loading. It stays hidden until it can be checked.
      if (moving.extent === EMPTY) continue;
      const all = [...placed(), moving];
      const fits =
        fitsAt(latest.current, moving, item.target, all) && !isOutside(latest.current, moving, all);
      const room = fits ? item.target : roomFor(item);
      item.arriving = false;
      item.group.visible = true;
      if (room) {
        commit(item, room, "arrival");
        item.fitted = room;
        // Shown there at once instead of easing from where it was put.
        item.shown.position.set(...room.position);
        item.shown.turn = room.turn;
        item.group.position.set(...room.position);
        item.group.rotation.set(0, THREE.MathUtils.degToRad(room.turn), 0);
      }
      changes.current++;
      latest.current.onArrive?.(item.id, room);
      scene.invalidate();
    }
  };

  // What onOutside was last told, and the inputs it was computed from.
  const reported = useRef({ key: "", ids: "", waiting: false });
  const reportOutside = () => {
    const { onOutside } = latest.current;
    if (!onOutside) return;
    const key = `${ruleset.current.version},${changes.current},${items.size}`;
    // Checked again when something changed, or while a model that may be outside is still loading.
    if (key === reported.current.key && !reported.current.waiting) return;
    const all = placed();
    reported.current.key = key;
    reported.current.waiting = all.some((m) => m.extent === EMPTY);
    const ids = all.filter((m) => isOutside(latest.current, m, all)).map((m) => m.item.id);
    const joined = ids.join("\n");
    if (joined === reported.current.ids) return;
    reported.current.ids = joined;
    onOutside(ids);
  };

  /** Moves `ids`, or everything outside the space, to the nearest place where each fits. Returns those left. */
  const moveInside = (ids?: readonly string[]) => {
    const list = ids
      ? ids.map((id) => items.get(id)).filter((item): item is Item => !!item && !item.arriving)
      : outsideNow().map((id) => items.get(id) as Item);
    const stuck: string[] = [];
    // Each moved item is shown at its new place while the next is checked, then put back to ease there.
    const shownWas: [Item, Place][] = [];
    const jump = (item: Item, place: Place) => {
      shownWas.push([item, placeOf(item)]);
      item.shown.position.set(...place.position);
      item.shown.turn = place.turn;
    };
    for (const item of list) {
      const all = placed();
      const moving = all.find((m) => m.item === item) as Measured;
      if (moving.extent === EMPTY) {
        stuck.push(item.id);
        continue;
      }
      if (!isOutside(latest.current, moving, all) && fitsAt(latest.current, moving, item.target, all))
        continue;
      const to = roomFor(item);
      if (!to) {
        stuck.push(item.id);
        continue;
      }
      const riders = ridersOf(moving, all);
      const from = placeOf(item);
      commit(item, to, "code");
      item.fitted = to;
      jump(item, to);
      for (const rider of riders) {
        const carriedTo = carried(placeOf(rider.item), from, to);
        commit(rider.item, carriedTo, "code");
        rider.item.fitted = carriedTo;
        jump(rider.item, carriedTo);
      }
    }
    for (const [item, was] of shownWas.reverse()) {
      item.shown.position.set(...was.position);
      item.shown.turn = was.turn;
    }
    if (list.length) scene.invalidate();
    return stuck;
  };

  // Rebuilt every render, so its methods use the latest props.
  useImperativeHandle(ref, () => ({
    turnBy: (id, degrees) => {
      const item = items.get(id);
      if (!item || item.on === "wall" || drag.current) return false;
      const space = latest.current;
      const all = placed();
      const moving = all.find((m) => m.item === item) as Measured;
      const { riders, others } = apart(moving, all);
      const from = placeOf(item);
      const turn = snapTurn(from.turn + degrees, space.steps.turn ?? 0);
      const [x, y, z] = from.position;
      const support = supportFor(item, x, y, z, others);
      const free =
        space.collide === "block"
          ? settle(space, moving, x, z, turn, y, support, others)
          : confine(space, moving, x, z, turn, support);
      if (!free) return false;
      const over =
        space.collide === "warn" ? overlapsAt(moving, free[0], free[1], turn, y, support, others) : [];
      const to: Place = { position: [free[0], y, free[1]], turn };
      // With "block" it is refused where it does not fit. Otherwise it turns anyway and is marked.
      if (!allowed(space, moving, to, support?.item.id ?? null, over) && space.collide === "block")
        return false;
      commitWithRiders(item, riders, to, "code");
      scene.invalidate();
      return true;
    },
    standingOn: (id) => {
      const item = items.get(id);
      if (!item) return [];
      const all = placed();
      return ridersOf(all.find((m) => m.item === item) as Measured, all).map((m) => m.item.id);
    },
    findFreePlace: (options) => measuring(() => freePlace(options)),
    outside: () => measuring(outsideNow),
    moveInside: (ids) => measuring(() => moveInside(ids)),
  }));

  const look = markerLook(marker);
  useFrame(() =>
    measuring(() => {
      arrive();
      reportOutside();
      const item = current === null ? undefined : items.get(current);
      const extent = item && !item.arriving ? measure(item).extent : null;
      const measured = extent === EMPTY ? null : extent;
      if (item && !drag.current) checkAtRest(item, measured);
      if (!item || !measured || !look) hidePatch(patch);
      else showPatch(patch, look, item, measured, fit.current.id !== item.id || fit.current.fits);
      return false;
    }),
  );

  return <PlacementContext.Provider value={state}>{children}</PlacementContext.Provider>;
}
