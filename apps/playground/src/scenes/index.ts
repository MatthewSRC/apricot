import type { ComponentType } from "react";
import Catalog from "./Catalog";
import Cinema from "./Cinema";
import Drive from "./Drive";
import FallingApples from "./FallingApples";
import HelloCube from "./HelloCube";
import Laptop from "./Laptop";
import MetalCard from "./MetalCard";
import MetroLine from "./MetroLine";
import MoneyStackScene from "./MoneyStack";
import OnDemand from "./OnDemand";
import ParticlesDemo from "./ParticlesDemo";
import PeachHero from "./PeachHero";
import PlacementDemo from "./PlacementDemo";
import Showroom from "./Showroom";
import WaterDemo from "./WaterDemo";

export interface PlaygroundScene {
  id: string;
  title: string;
  summary: string;
  component: ComponentType;
}

export const SCENES: PlaygroundScene[] = [
  {
    id: "peach",
    title: "Peach",
    summary: "Apricot's mascot: swipe to spin it; more peaches tumble behind it, out of focus.",
    component: PeachHero,
  },
  {
    id: "placement",
    title: "Placement",
    summary:
      "A room to furnish: drag and turn pieces, put small things on tables and shelves and frames on the walls; undo, time of day, a snapshot.",
    component: PlacementDemo,
  },
  {
    id: "water",
    title: "Water",
    summary:
      "A sandbank in the sea: things float and ride the waves, loungers snap to the deck, the boat moors at its spot.",
    component: WaterDemo,
  },
  {
    id: "catalog",
    title: "Catalog",
    summary:
      "One big item and small ones below it: tap one and it becomes the big one, in the same scene, the camera flying to frame it. The scenes share one renderer, so the stage reuses what the tiles compiled.",
    component: Catalog,
  },
  {
    id: "particles",
    title: "Particles",
    summary:
      "Sparkles, confetti and fireworks by tap; a fountain, chimney smoke, a sparkler and snow that stream while on.",
    component: ParticlesDemo,
  },
  {
    id: "cinema",
    title: "Cinema seats",
    summary: "448 seats as copies of one seat: tap to pick them, drag to look round.",
    component: Cinema,
  },
  {
    id: "metro-line",
    title: "Metro line",
    summary:
      "A train runs a curved viaduct, stops at stations; the camera follows and drifts. Tap ☀︎ for the time of day.",
    component: MetroLine,
  },
  {
    id: "showroom",
    title: "Showroom",
    summary: "Change the colour, tap doors to open them, fly to named views. Your own models: assets/local.",
    component: Showroom,
  },
  {
    id: "laptop",
    title: "Laptop",
    summary: "Drag the lid open with a joint or a Blender animation; it springs shut.",
    component: Laptop,
  },
  {
    id: "metal-card",
    title: "Metal card",
    summary: "Materials test: seven finishes with studio reflections. Drag to turn, tilt the phone.",
    component: MetalCard,
  },
  {
    id: "drive",
    title: "Drive",
    summary: "Drive a toy car (a .glb) with the joystick; the camera follows.",
    component: Drive,
  },
  {
    id: "falling-apples",
    title: "Falling apples",
    summary: "3D apples drop over a normal screen for 5 s and pile up. The list stays usable.",
    component: FallingApples,
  },
  {
    id: "money-stack",
    title: "Money stack",
    summary: "A money stack that spins on its own; swipe to fling it. One draw call for 40 bills.",
    component: MoneyStackScene,
  },
  {
    id: "hello-cube",
    title: "Hello cube",
    summary: 'A lit cube that never stops: frameloop="always".',
    component: HelloCube,
  },
  {
    id: "on-demand",
    title: "On-demand rendering",
    summary: "Renders only while animating: tap to spin, then the loop sleeps.",
    component: OnDemand,
  },
];
