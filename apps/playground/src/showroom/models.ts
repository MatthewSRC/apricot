import type { MaterialInput } from "@apricotjs/react-native";
import { defineModelKit, type KitPart, type ModelKit } from "@apricotjs/react-native/model";

/** A model for the Showroom scene, with its kit and materials. */
export interface ShowroomModel {
  id: string;
  title: string;
  kit: ModelKit;
  materials: Record<string, MaterialInput>;
  /** Kit part whose colour the swatches change. */
  paint?: string;
  /** Attribution shown under the scene. */
  credit?: string;
}

// The procedural sedan has Italian part names. The kit maps them to app names, so the scene never uses
// names like "porta_ant_sx".
export const sedan = defineModelKit(require("../../assets/models/sedan.glb"), {
  paint: "material:vernice",
  glass: "material:vetro",
  rims: "material:cerchio",
  tyres: "material:gomma",
  lights: "material:luce",
  tailLights: "material:luce_posteriore",
  grille: "material:plastica_nera",
  interior: "material:interni",
  doorFrontLeft: { select: "porta_ant_sx", hinge: "front", axis: "y", range: [0, -65] },
  doorFrontRight: { select: "porta_ant_dx", hinge: "front", axis: "y", range: [0, 65] },
  doorRearLeft: { select: "porta_post_sx", hinge: "front", axis: "y", range: [0, -65] },
  doorRearRight: { select: "porta_post_dx", hinge: "front", axis: "y", range: [0, 65] },
  hood: { select: "cofano", hinge: "back", axis: "x", range: [0, -40] },
  trunk: { select: "bagagliaio", hinge: "front", axis: "x", range: [0, 50] },
});

const SEDAN: ShowroomModel = {
  id: "sedan",
  title: "Sedan",
  kit: sedan,
  paint: "paint",
  materials: {
    paint: { preset: "car-paint" },
    glass: "tinted-glass",
    rims: "chrome",
    tyres: "rubber",
    lights: "light",
    tailLights: { preset: "light", color: "#b3121b" },
    grille: "gloss-black",
    interior: "matte",
  },
};

/** The optional `name.kit.json` file next to a local `name.glb`. */
interface KitFile {
  title?: string;
  credit?: string;
  paint?: string;
  parts?: Record<string, KitPart>;
  materials?: Record<string, MaterialInput>;
}

// Local models in assets/local, which are not committed. See assets/local/README.md.
const local = require.context("../../assets/local", false, /\.(glb|json)$/);

const localModels = (): ShowroomModel[] => {
  const keys = local.keys();
  return keys
    .filter((key) => key.endsWith(".glb"))
    .map((key) => {
      const id = key.replace(/^\.\//, "").replace(/\.glb$/, "");
      const kitKey = `./${id}.kit.json`;
      const file: KitFile = keys.includes(kitKey) ? local(kitKey) : {};
      return {
        id: `local:${id}`,
        title: file.title ?? id,
        kit: defineModelKit(local(key) as number, file.parts ?? {}),
        materials: file.materials ?? {},
        paint: file.paint,
        credit: file.credit,
      };
    });
};

export const SHOWROOM_MODELS: ShowroomModel[] = [SEDAN, ...localModels()];
