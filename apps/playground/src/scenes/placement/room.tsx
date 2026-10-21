import { Box, Merged, WindowPane } from "@apricotjs/react-native";

// A room open on two sides like a dollhouse: a floor, a back wall, and a right wall with a window.

export const ROOM = {
  /** Inside size from wall to wall. x runs from -2 to 2 and z from -1.5 to 1.5. */
  width: 4,
  depth: 3,
  height: 2.5,
  wall: 0.1,
  /** The window in the right wall, with its centre at (z, y). */
  window: { z: -0.5, y: 1.4, width: 0.9, height: 1.2 },
};

const W = ROOM.width / 2;
const D = ROOM.depth / 2;
const T = ROOM.wall;
const H = ROOM.height;
const win = ROOM.window;

export const BOUNDS = [-W, -D, W, D] as const;
/** Turns that make a piece hung on the back or the right wall face into the room. */
export const BACK = 0;
export const RIGHT = 270;
export const WINDOW_MIDDLE = [W, win.y, win.z] as const;
/** Where the window is placed as a wall piece, so other wall pieces keep clear of it. */
export const WINDOW_PLACE = { position: [W, win.y, win.z] as [number, number, number], turn: RIGHT };

const C = { slab: "#f6f1eb", floor: "#dcb894", wall: "#f1e8df", frame: "#ffffff" };

export function Room() {
  const low = win.y - win.height / 2;
  const high = win.y + win.height / 2;
  const back = win.z - win.width / 2;
  const front = win.z + win.width / 2;
  return (
    <>
      <Merged roughness={0.85}>
        <Box
          size={[ROOM.width + T + 0.14, 0.16, ROOM.depth + T + 0.08]}
          position={[T / 2, -0.1, -T / 2]}
          color={C.slab}
        />
        <Box size={[ROOM.width, 0.02, ROOM.depth]} position={[0, -0.01, 0]} color={C.floor} />
        <Box size={[ROOM.width + T, H, T]} position={[T / 2, H / 2, -D - T / 2]} color={C.wall} />
        {/* The right wall in four parts around the window. */}
        <Box size={[T, H, back + D + T]} position={[W + T / 2, H / 2, (back - D - T) / 2]} color={C.wall} />
        <Box size={[T, H, D - front]} position={[W + T / 2, H / 2, (front + D) / 2]} color={C.wall} />
        <Box size={[T, low, win.width]} position={[W + T / 2, low / 2, win.z]} color={C.wall} />
        <Box size={[T, H - high, win.width]} position={[W + T / 2, (H + high) / 2, win.z]} color={C.wall} />
      </Merged>
      {/* A roof and walls on the open sides that only cast shadows, so sunlight comes in only through the
          window. */}
      <Box
        size={[ROOM.width + 2 * T + 0.4, 0.05, ROOM.depth + 2 * T + 0.4]}
        position={[0, H + 0.1, 0]}
        shadowOnly
      />
      <Box size={[ROOM.width + 2 * T + 0.4, H + 0.6, T]} position={[0, H / 2, D + T / 2 + 0.01]} shadowOnly />
      <Box
        size={[T, H + 0.6, ROOM.depth + 2 * T + 0.4]}
        position={[-W - T / 2 - 0.01, H / 2, 0]}
        shadowOnly
      />
    </>
  );
}

/** The window frame and its glass, which is bright by day and dark at night. Hung like a wall piece. */
export function Window() {
  const { width: w, height: h } = win;
  return (
    <>
      <Merged roughness={0.5}>
        {[-1, 1].map((side) => (
          <Box
            key={`v${side}`}
            size={[0.05, h, 0.1]}
            position={[side * (w / 2 - 0.025), 0, -0.05]}
            color={C.frame}
          />
        ))}
        {[-1, 1].map((side) => (
          <Box
            key={`h${side}`}
            size={[w, 0.05, 0.1]}
            position={[0, side * (h / 2 - 0.025), -0.05]}
            color={C.frame}
          />
        ))}
        <Box
          size={[w + 0.1, 0.035, 0.12]}
          position={[0, -h / 2 - 0.0175, 0.02]}
          radius={0.008}
          color={C.frame}
        />
      </Merged>
      <WindowPane size={[w - 0.05, h - 0.05]} position={[0, 0, -0.08]} day="#fff3df" />
    </>
  );
}
