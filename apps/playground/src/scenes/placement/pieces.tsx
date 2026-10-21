import { Box, Cylinder, Lamp, Merged, type Place, type PlaceOn, Sphere } from "@apricotjs/react-native";
import type { ReactNode } from "react";
import { BACK, ROOM, WINDOW_PLACE, Window } from "./room";

// Pieces built from shapes. Each stands on its origin facing +z, or for wall pieces hangs from it with
// its back at z = 0.

export interface PieceSpec {
  name: string;
  /** Where it goes (default the floor). */
  on?: PlaceOn;
  /** Others can stand on its top. */
  surface?: boolean;
  /** Others can't overlap it (default true). */
  solid?: boolean;
  /** Can't be moved. */
  locked?: boolean;
  /** Not offered in the "add" list. */
  fixed?: boolean;
  make: () => ReactNode;
}

const TABLE_TOP = 0.74;
const CABINET_TOP = 0.8;
const SHELF_Y = 1.45;

const SPECS = {
  table: {
    name: "Table",
    surface: true,
    make: () => (
      <Merged roughness={0.6}>
        <Box size={[1.1, 0.05, 0.65]} position={[0, TABLE_TOP - 0.025, 0]} radius={0.01} color="#c99a6e" />
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <Cylinder
              key={`${x}${z}`}
              radius={0.03}
              height={TABLE_TOP - 0.05}
              position={[x * 0.48, (TABLE_TOP - 0.05) / 2, z * 0.26]}
              color="#a87b52"
            />
          )),
        )}
      </Merged>
    ),
  },
  cabinet: {
    name: "Cabinet",
    surface: true,
    make: () => (
      <Merged roughness={0.7}>
        <Box
          size={[0.9, CABINET_TOP, 0.4]}
          position={[0, CABINET_TOP / 2, 0]}
          radius={0.02}
          color="#8fb3a8"
        />
        <Box size={[0.02, CABINET_TOP - 0.1, 0.01]} position={[0, CABINET_TOP / 2, 0.2]} color="#7a9c92" />
      </Merged>
    ),
  },
  cube: {
    name: "Cube",
    make: () => <Box size={0.45} position={[0, 0.225, 0]} radius={0.05} color="#e98a6a" />,
  },
  rug: {
    name: "Rug",
    solid: false,
    make: () => <Box size={[1.5, 0.012, 1]} position={[0, 0.006, 0]} radius={0.005} color="#e9d8c4" />,
  },
  plant: {
    name: "Plant",
    make: () => (
      <Merged roughness={0.8}>
        <Cylinder radius={0.15} radiusTop={0.18} height={0.3} position={[0, 0.15, 0]} color="#d8cfc4" />
        <Sphere radius={0.3} position={[0, 0.58, 0]} color="#6fa36b" />
        <Sphere radius={0.2} position={[0.12, 0.82, 0.05]} color="#7db478" />
      </Merged>
    ),
  },
  lamp: {
    name: "Lamp",
    on: "surface",
    make: () => (
      <>
        <Merged roughness={0.6}>
          <Cylinder radius={0.07} height={0.025} position={[0, 0.0125, 0]} color="#e9e1d9" />
          <Cylinder radius={0.012} height={0.3} position={[0, 0.17, 0]} color="#c9b4a0" />
          <Cylinder radius={0.13} radiusTop={0.1} height={0.2} position={[0, 0.39, 0]} color="#f2c29a" />
        </Merged>
        {/* Switches on when it gets dark. */}
        <Lamp position={[0, 0.36, 0]} on="dark" glow={0.2} intensity={1.4} distance={3} color="#ffbf80" />
      </>
    ),
  },
  ball: {
    name: "Ball",
    on: "surface",
    make: () => <Sphere radius={0.09} position={[0, 0.09, 0]} color="#6c8fd6" />,
  },
  cup: {
    name: "Cup",
    on: "surface",
    make: () => <Cylinder radius={0.045} height={0.1} position={[0, 0.05, 0]} color="#f4f0ea" />,
  },
  frame: {
    name: "Frame",
    on: "wall",
    make: () => (
      <Merged roughness={0.5}>
        <Box size={[0.55, 0.42, 0.03]} position={[0, 0, 0.015]} color="#ffffff" />
        <Box size={[0.45, 0.32, 0.01]} position={[0, 0, 0.032]} color="#9cc3e6" />
      </Merged>
    ),
  },
  wallShelf: {
    name: "Wall shelf",
    on: "wall",
    surface: true,
    make: () => <Box size={[0.8, 0.04, 0.22]} position={[0, -0.02, 0.11]} color="#c99a6e" />,
  },
  window: { name: "Window", on: "wall", locked: true, fixed: true, make: () => <Window /> },
} satisfies Record<string, PieceSpec>;

export type Kind = keyof typeof SPECS;
export const PIECES: Record<Kind, PieceSpec> = SPECS;

export interface Piece extends Place {
  id: string;
  kind: Kind;
}

const D = ROOM.depth / 2;

export const START: Piece[] = [
  { id: "window", kind: "window", ...WINDOW_PLACE },
  { id: "rug", kind: "rug", position: [-0.5, 0, 0.3], turn: 0 },
  { id: "table", kind: "table", position: [-0.5, 0, 0.3], turn: 0 },
  { id: "cabinet", kind: "cabinet", position: [0.9, 0, -D + 0.2], turn: 0 },
  { id: "cube", kind: "cube", position: [1.4, 0, 0.8], turn: 20 },
  { id: "plant", kind: "plant", position: [-1.6, 0, -D + 0.35], turn: 0 },
  { id: "lamp", kind: "lamp", position: [1.15, CABINET_TOP, -D + 0.2], turn: 0 },
  { id: "ball", kind: "ball", position: [0.6, CABINET_TOP, -D + 0.2], turn: 0 },
  { id: "cup", kind: "cup", position: [-0.75, TABLE_TOP, 0.4], turn: 0 },
  { id: "frame", kind: "frame", position: [-0.5, 1.5, -D], turn: BACK },
  { id: "wall-shelf", kind: "wallShelf", position: [0.9, SHELF_Y, -D], turn: BACK },
  { id: "shelf-cup", kind: "cup", position: [1.1, SHELF_Y, -D + 0.11], turn: 0 },
];
