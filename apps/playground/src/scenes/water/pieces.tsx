import {
  Box,
  Cone,
  Cylinder,
  Group,
  Merged,
  type Place,
  type PlaceOn,
  type SnapPoint,
  Sphere,
  Torus,
} from "@apricotjs/react-native";
import type { ReactNode } from "react";
import { DECK, SAND, SEA } from "./ground";

// Pieces built from shapes, each standing on its origin facing +z.

export interface PieceSpec {
  name: string;
  /** Where it goes (default the ground). "water" pieces float and ride the waves. */
  on?: PlaceOn;
  /** Others can stand on its top. */
  surface?: boolean;
  /** Others can't overlap it (default true). */
  solid?: boolean;
  make: () => ReactNode;
}

const SPECS = {
  lounger: {
    name: "Lounger",
    make: () => (
      <Merged roughness={0.6}>
        <Box size={[0.5, 0.08, 1]} position={[0, 0.22, 0.1]} radius={0.03} color="#f4f1ea" />
        <Box
          size={[0.5, 0.08, 0.4]}
          position={[0, 0.34, -0.48]}
          rotation={[0.7, 0, 0]}
          radius={0.03}
          color="#f4f1ea"
        />
        {[-1, 1].flatMap((x) =>
          [-0.3, 0.5].map((z) => (
            <Box key={`${x}${z}`} size={[0.04, 0.18, 0.04]} position={[x * 0.2, 0.09, z]} color="#c08455" />
          )),
        )}
      </Merged>
    ),
  },
  parasol: {
    name: "Parasol",
    // Others can go under its canopy.
    solid: false,
    make: () => (
      <>
        <Cylinder radius={0.02} height={1.6} position={[0, 0.8, 0]} color="#e9e1d9" />
        {/* The canopy takes up no ground, so only the pole counts as its footprint. */}
        <Group footprint={false}>
          <Cone radius={0.75} height={0.32} position={[0, 1.6, 0]} color="#ef7a62" />
        </Group>
      </>
    ),
  },
  crate: {
    name: "Crate",
    surface: true,
    make: () => <Box size={[0.45, 0.4, 0.45]} position={[0, 0.2, 0]} radius={0.02} color="#c99a6e" />,
  },
  ball: {
    name: "Ball",
    on: "surface",
    make: () => <Sphere radius={0.12} position={[0, 0.12, 0]} color="#ffcf4a" />,
  },
  ring: {
    name: "Swim ring",
    on: "water",
    make: () => (
      <Torus radius={0.3} tube={0.1} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} color="#ff8fb1" />
    ),
  },
  buoy: {
    name: "Buoy",
    on: "water",
    make: () => (
      <Merged roughness={0.4}>
        <Cylinder radius={0.16} height={0.3} position={[0, 0.05, 0]} color="#f25c4a" />
        <Cylinder radius={0.165} height={0.08} position={[0, 0.12, 0]} color="#ffffff" />
        <Sphere radius={0.07} position={[0, 0.25, 0]} color="#f25c4a" />
      </Merged>
    ),
  },
  boat: {
    name: "Boat",
    on: "water",
    make: () => (
      <Merged roughness={0.6}>
        <Box size={[0.7, 0.24, 1.5]} position={[0, 0.03, 0]} radius={0.11} color="#ffffff" />
        <Box size={[0.58, 0.04, 1.3]} position={[0, 0.15, 0]} radius={0.015} color="#c08455" />
        <Box size={[0.6, 0.04, 0.16]} position={[0, 0.2, 0.1]} color="#9c6640" />
      </Merged>
    ),
  },
} satisfies Record<string, PieceSpec>;

export type Kind = keyof typeof SPECS;
export const PIECES: Record<Kind, PieceSpec> = SPECS;

export interface Piece extends Place {
  id: string;
  kind: Kind;
}

// Two lounger spots on the deck, and a mooring for the boat.
const LOUNGERS = [1.7, 2.4];
const MOORING = [-2.5, -1.3] as const;
export const SNAPS: SnapPoint[] = [
  ...LOUNGERS.map((x) => ({
    at: [x, -0.4] as const,
    turn: 0,
    radius: 0.35,
    accepts: (id: string) => id.startsWith("lounger"),
  })),
  { at: MOORING, turn: 30, radius: 0.6, accepts: (id: string) => id.startsWith("boat") },
];

export const START: Piece[] = [
  { id: "lounger-a", kind: "lounger", position: [LOUNGERS[0], DECK.top, -0.4], turn: 0 },
  { id: "lounger-b", kind: "lounger", position: [LOUNGERS[1], DECK.top, -0.4], turn: 0 },
  { id: "parasol", kind: "parasol", position: [2.05, DECK.top, -0.7], turn: 0 },
  { id: "crate", kind: "crate", position: [0.5, SAND, -1.2], turn: 15 },
  { id: "ball", kind: "ball", position: [0.5, SAND + 0.4, -1.2], turn: 0 },
  { id: "ring", kind: "ring", position: [-2.0, SEA, 1.3], turn: 0 },
  { id: "buoy", kind: "buoy", position: [-2.9, SEA, 0.4], turn: 0 },
  { id: "boat", kind: "boat", position: [MOORING[0], SEA, MOORING[1]], turn: 30 },
];
