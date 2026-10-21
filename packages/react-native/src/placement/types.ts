import type { Extent, Footprint, Outline, PlacementBounds, Vec3, Waves } from "@apricotjs/core";
import type { ReactNode, Ref } from "react";
import type * as THREE from "three/webgpu";

/** Where a placed object is: its position in metres and its turn around the vertical axis in degrees. */
export interface Place {
  position: Vec3;
  turn: number;
}

/** Snapping applied while an object is moved. */
export interface PlacementSnap {
  /** Grid step for positions, in metres. Default 0 (no grid). */
  grid?: number;
  /** Step for turns, in degrees. Default 0 (free turning). */
  turn?: number;
  /** Distance in metres within which an object snaps flush against a wall. Default 0 (off). */
  wall?: number;
}

/** Where a <Placeable> goes: on the floor, on top of a surface or the floor, hung on a wall, or on water. */
export type PlaceOn = "floor" | "surface" | "wall" | "water";

/** A region of ground or water that objects stand in. See <Placement areas>. */
export interface PlacementArea {
  /** Passed to canPlace as `area` for objects standing in it. */
  id?: string;
  /** Its outline as (x, z) corners, in metres. Use smoothOutline for a rounded shore. */
  outline: Outline;
  /** Height of its top, where objects stand, in metres. Default 0. */
  level?: number;
  /**
   * Marks the area as water. Objects with on="water" float in it, bobbing on
   * these waves if given. Other objects are kept out of it.
   */
  water?: Waves | true;
}

/** A free-standing wall on the floor, such as a partition or a screen. See <Placement walls>. */
export interface WallLine {
  /**
   * Passed to canPlace in `zones` for floor objects touching it. Default
   * `wall <n>`, where n is its index in `walls`.
   */
  id?: string;
  /** One end (x, z), in metres. */
  from: readonly [number, number];
  /** The other end (x, z), in metres. */
  to: readonly [number, number];
  /** Its height in metres. Default: the Placement's `wallHeight`. */
  height?: number;
}

/** A region no object may stand in, such as rocks, a flower bed or a doorway. See <Placement zones>. */
export interface PlacementZone {
  /** Passed to canPlace in `zones` for objects touching it. Default `zone <n>`, where n is its index. */
  id?: string;
  /** Its outline as (x, z) corners, in metres. */
  outline: Outline;
}

/** A point that pulls nearby objects onto it and turns them, such as a lounger's spot by a pool. */
export interface SnapPoint {
  /** Its position (x, z), in metres. */
  at: readonly [number, number];
  /** Turn in degrees given to an object that snaps to it. Default: the object keeps its turn. */
  turn?: number;
  /** Distance in metres within which it pulls objects. Default 0.3. */
  radius?: number;
  /** Which objects it accepts, by id. Default: all. */
  accepts?: (id: string) => boolean;
}

/**
 * What a moved object does when it meets another solid object.
 *
 * - "block": it stops against the other object and slides along it.
 * - "warn": it passes through. The marker shows the `blocked` colour while it
 *   overlaps, and if it is released there it returns to the last place where
 *   it fitted. It can also pass over water, no-go zones and the other kind of
 *   ground.
 * - "off": it passes through, and overlaps are not checked.
 */
export type Collide = "block" | "warn" | "off";

/** Passed to canPlace: details of the place an object is being moved or turned to. */
export interface PlaceCheck {
  /** How the object is placed. */
  on: PlaceOn;
  /** Id of the object it would stand on, or null when it is on the floor or a wall. */
  standingOn: string | null;
  /**
   * Ids of the solid objects it would overlap. Always empty with collide
   * "off", and while moving with collide "block".
   */
  overlapping: string[];
  /** Id of the area it would stand or float in (see <Placement areas>), or null. */
  area: string | null;
  /** Ids of the no-go zones it would touch (see <Placement zones>). The place does not fit if there are any. */
  zones: string[];
}

/** Appearance of the marker drawn under the selected object, or behind it on a wall. */
export interface MarkerOptions {
  /** Colour where the object fits. Default "#4f8cff". */
  color?: THREE.ColorRepresentation;
  /** Colour where it does not fit (it overlaps something, or canPlace refuses). Default "#ff5a4f". */
  blocked?: THREE.ColorRepresentation;
  /** Opacity from 0 to 1. Default 0.8. */
  opacity?: number;
  /** How far the marker extends past the object on each side, in metres. Default 0.12. */
  margin?: number;
  /** Corner radius in metres. Default 0.06. A large value gives a pill or a disc. */
  radius?: number;
  /** Width of an outline ring in metres, or 0 for a filled marker. Default 0. */
  outline?: number;
}

/** Why an object's place changed. See <Placement onChange>. */
export interface PlaceChange {
  /**
   * - "hand": moved or turned by touch, or carried by the object it stands on.
   * - "code": moved by a PlacementHandle method (turnBy, moveInside).
   * - "arrival": a <Placeable findRoom> moved to free space when it appeared.
   *   This is not a user action, and `useLayout().place` keeps it out of the
   *   undo history.
   */
  by: "hand" | "code" | "arrival";
}

/** Moves objects from code, with the same checks as moving them by hand. See <Placement ref>. */
export interface PlacementHandle {
  /**
   * Turns an object by `degrees`, snapped to the turn step, together with
   * what stands on it. Returns false if the object does not exist, hangs on
   * a wall, or no area can hold it at the new turn, and while any object is
   * being dragged. With collide "block" it also returns false when there is
   * no room to turn or canPlace refuses. With other collide modes it turns
   * even where it does not fit, and returns to the last place where it
   * fitted when it is put down.
   */
  turnBy: (id: string, degrees: number) => boolean;
  /** Ids of the objects standing on an object, such as the things on a desk. */
  standingOn: (id: string) => string[];
  /**
   * Finds a place where an object would fit, with the same checks as moving
   * it by hand: the grid point nearest to `near`, or null when there is no
   * room. For an object not placed yet, such as one about to be bought, give
   * its `size` or `extent`. For an object already in the placement, give its
   * `id`: it is measured and does not block itself. Returns null while that
   * object's model is loading. Objects whose models are still loading block
   * nothing.
   */
  findFreePlace: (options: FreePlaceOptions) => Place | null;
  /**
   * Ids of the objects that are now outside the space (see <Placement
   * onOutside>), for example after the bounds shrank or the walls or areas
   * changed.
   */
  outside: () => string[];
  /**
   * Moves objects to the nearest place where they fit, together with what
   * stands on them, and reports each move to onChange with `by: "code"`.
   * Moves the objects in `ids`, or every object outside the space when `ids`
   * is omitted. Returns the ids of the objects that found no room; they stay
   * where they are.
   */
  moveInside: (ids?: readonly string[]) => string[];
}

/** The object to find room for. See PlacementHandle.findFreePlace. */
export interface FreePlaceOptions {
  /**
   * Its size as [width, height, depth] in metres, as for <Box size>. Its
   * origin is the middle of its bottom, or the middle of its back on a wall.
   * Alternatively give `extent`.
   */
  size?: readonly [number, number, number];
  /** Its exact extent around its origin. For a model, get it from measureModel. */
  extent?: Extent;
  /** Where it goes. Default "floor", or the object's own. "surface" tries the tops of surfaces first, then the floor. */
  on?: PlaceOn;
  /**
   * The id passed to canPlace. Default "". If it is the id of an object
   * already in the placement, that object is measured when neither `size`
   * nor `extent` is given; `on`, `solid` and `turn` default to its own; and
   * it does not block itself or what stands on it.
   */
  id?: string;
  /** Its turn in degrees. Default 0, or the object's own. On a wall, the wall's turn is used. */
  turn?: number;
  /** The point (x, z) to search around. Default: the middle of the space. */
  near?: readonly [number, number];
  /** Spacing of the places tried, in metres. Default: the snap grid, or 0.1. */
  step?: number;
  /** On a wall: the height to hang it at, if there is room there. Default 1.5. */
  height?: number;
  /** Whether it blocks other objects. Default true, or the object's own. Use false for a rug. */
  solid?: boolean;
}

export interface PlacementProps {
  /**
   * The floor area objects stay inside, as [minX, minZ, maxX, maxZ] in metres,
   * such as a room's walls. Default: no limit.
   */
  bounds?: PlacementBounds;
  /** Height of the walls around `bounds`, or of `walls`, in metres. Default 2.4. */
  wallHeight?: number;
  /**
   * Walls of any shape, used instead of the four walls around `bounds` for
   * hanging objects and snapping them flush. A room outline (x, z corners)
   * gives walls facing in; without `areas`, it is also the floor. A
   * `{ from, to }` line is a free-standing wall such as a partition: it has a
   * face on each side, and floor objects cannot pass through it.
   */
  walls?: readonly (Outline | WallLine)[];
  /**
   * Ground of any shape, such as an island, a deck or a pool. Objects stay
   * wholly inside one area, at its level, and slide along its edge. Objects
   * with on="water" stay in water areas and bob on their waves; all others
   * stay in the other areas. Default: no limit other than `bounds`.
   */
  areas?: readonly PlacementArea[];
  /** Regions no object may touch, such as rocks or a flower bed. */
  zones?: readonly PlacementZone[];
  /** Points that pull nearby objects into place and turn them, such as loungers along a pool. */
  snaps?: readonly SnapPoint[];
  /** Snapping while moving, for example `{ grid: 0.1, turn: 15, wall: 0.1 }`. */
  snap?: PlacementSnap;
  /** Id of the selected object, to control selection yourself. Omit it to let taps select. */
  selected?: string | null;
  /** Called with the id of the object that was selected, or null when a tap on empty space deselects it. */
  onSelect?: (id: string | null) => void;
  /**
   * Called when an object was moved or turned and released, moved by code,
   * or found room when it appeared, with its new place and the reason (see
   * PlaceChange). Store the place and pass it back as the object's props;
   * `useLayout().place` accepts these arguments. Objects standing on it
   * report their new places too.
   */
  onChange?: (id: string, place: Place, change: PlaceChange) => void;
  /**
   * Called once for each <Placeable findRoom> after it was checked, with its
   * place (where it was put, or where it found room), or null if there was
   * no room, in which case it stays where it was put. Use it to show an
   * effect where a purchase lands, or to refund it.
   */
  onArrive?: (id: string, place: Place | null) => void;
  /**
   * Called when the set of objects outside the space changes, with the ids of
   * the objects now wholly or partly outside the bounds or their areas, or
   * hung on a wall that was removed. This happens when the space shrinks
   * or changes, or when code puts an object outside it. Nothing is moved
   * automatically: move them by hand, or with the handle's `moveInside`.
   */
  onOutside?: (ids: string[]) => void;
  /** How high a dragged object is raised, in metres. Default 0.03. */
  lift?: number;
  /** What a moved object does when it meets another. Default "block". See Collide. */
  collide?: Collide;
  /**
   * Your own rule for where objects may go, such as a no-go zone or only
   * plants on the balcony. Called while an object is moved or turned, with
   * the place it would have. When it returns false with collide "block", the
   * object stays at the last place where it fitted. With other collide
   * modes, the marker shows the `blocked` colour, and the object returns to
   * that place if it is released there.
   */
  canPlace?: (id: string, place: Place, check: PlaceCheck) => boolean;
  /** Called when the selected object starts or stops fitting where it is, for example to disable a button. */
  onFitChange?: (id: string, fits: boolean) => void;
  /** The marker under the selected object, or behind it on a wall: a colour, MarkerOptions, or false for none. */
  marker?: THREE.ColorRepresentation | MarkerOptions | false;
  ref?: Ref<PlacementHandle>;
  children?: ReactNode;
}

export interface PlaceableProps {
  /** Unique among the objects of its <Placement>. Reported by onSelect and onChange. */
  id: string;
  /**
   * Its position (x, y, z) in metres: on the floor (y is the level it moves
   * along), on a surface, or on a wall.
   */
  position?: Vec3;
  /** Turn around the vertical axis, in degrees. On a wall, it is set by the wall it hangs on. */
  turn?: number;
  /**
   * Where it goes. Default "floor".
   *
   * - "surface": small objects that stand on top of surfaces, such as a lamp
   *   on a desk, or on the floor.
   * - "wall": objects hung on walls, such as frames or shelves, facing out.
   * - "water": objects that float in water areas, bobbing on their waves.
   */
  on?: PlaceOn;
  /**
   * Lets objects with on="surface" stand on it and move with it: true for its
   * top, or the height of the top in its own space, in metres.
   */
  surface?: boolean | number;
  /** Whether it blocks other objects and is blocked by them. Default true. Use false for a rug. */
  solid?: boolean;
  /** Prevents selecting it. It still blocks taps, as fixed furniture does. */
  locked?: boolean;
  /**
   * If it does not fit where it first appears, or where its model loads,
   * because it overlaps others, is outside the space or canPlace refuses, it
   * moves to the nearest place where it fits before it is drawn. The move is
   * reported to onChange with `by: "arrival"`, and onArrive is called. Useful
   * for objects added by code: put them anywhere, such as the middle of the
   * room, and they find room nearby. Safe to set on every movable object: one
   * that already fits stays where it is and reports no change.
   */
  findRoom?: boolean;
  /**
   * The floor area it takes up, in metres around its origin, instead of the
   * measured size of its parts: `[width, depth]` centred on the origin, or
   * the sides `{ minX, maxX, minZ, maxZ }`. For example, a palm takes up its
   * trunk, not the sand under its fronds. To leave out only some parts, put
   * them in `<Group footprint={false}>`.
   */
  footprint?: readonly [number, number] | Footprint;
  children?: ReactNode;
}
