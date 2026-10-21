/**
 * Placing objects by hand: furniture in a room, props on an island, parts
 * on a car. This is the maths behind <Placement> and <Placeable>, and it
 * can be used on its own. Distances are in metres and turns in degrees
 * around the vertical (y) axis.
 */
export {
  type Extent,
  type Footprint,
  footprintOf,
  keepInside,
  leaveOutOfFootprint,
  type PlacementBounds,
  snap,
  snapTurn,
  turnedFootprint,
} from "./placement/footprint";
export { gridNear, gridNearEach } from "./placement/grid";
export { cornersOf, covers, keepOn, overlap, type Placed, separate } from "./placement/overlap";
export { fingerAngle, floorPoint, twist } from "./placement/screen";
export {
  alongWall,
  facesWall,
  type Hung,
  hangOn,
  hungOverlap,
  snapToWalls,
  type Wall,
  wallPoint,
  wallsAlong,
  wallsAround,
  wallsOf,
} from "./placement/walls";
