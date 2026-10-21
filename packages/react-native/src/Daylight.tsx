import {
  type ApricotScene,
  DAY,
  type DaylightKey,
  type DaylightState,
  daylightAt,
  StudioEnvironmentNode,
  shadowBalance,
} from "@apricotjs/core";
import { useCallback, useEffect, useState } from "react";
import * as THREE from "three/webgpu";
import type { Animatable } from "./animatable";
import { useScene } from "./context";
import { useDriven } from "./modelParts";
import { useAttach } from "./parent";

export interface DaylightProps {
  /**
   * Hour of the day, from 0 to 24 (13.5 is half past one). A change to a
   * plain value animates over `transition`; a shared value is followed as it
   * changes.
   */
  time: Animatable<number>;
  /** Seconds that a change to a plain `time` takes (default 1.5). */
  transition?: number;
  /** Sets the background and fog colour to the sky colour (default true). Ignored in a `transparent` scene. */
  background?: boolean;
  /** Rotates the compass, in radians (default 0: the sun rises towards +x). */
  north?: number;
  /** The colours through the day (default DAY). Replace them for a different mood. */
  keys?: readonly DaylightKey[];
  /** Hour of sunrise (default 6, matching DAY). */
  sunrise?: number;
  /** Hour of sunset (default 19, matching DAY). */
  sunset?: number;
  /**
   * Multipliers for the sun's and the sky's brightness (default 1 each). An
   * interior lit through a window needs a much stronger sun than an outdoor
   * scene, for example `{ sun: 4 }`.
   */
  strength?: { sun?: number; sky?: number };
}

/** The current light of a scene's <Daylight>, as read by useDaylight. */
export interface DaylightNow extends DaylightState {
  /** The hour shown, which eases towards `time` after a plain change. */
  hour: number;
  /** Brightness of the sun or moon, from 0 to 1 relative to the brightest key. */
  level: number;
}

const currentLight = new WeakMap<ApricotScene, DaylightNow | null>();

/**
 * Returns a function that reads the current light of the scene's <Daylight>,
 * or null if there is none. Call it in frame callbacks to follow the time of
 * day, for example a beam through a window or lamps that switch on at dusk.
 * See <LightBeam sun> and <Lamp on="dark">.
 */
export const useDaylight = () => {
  const scene = useScene();
  return useCallback(() => currentLight.get(scene) ?? null, [scene]);
};

/**
 * Sun, sky light and background for a time of day. Use it with look="none".
 * All values are live, so a day cycle driven by a slider or a clock costs
 * nothing per frame. When the scene has an environment, its reflections dim
 * at night.
 *
 *   <Scene look="none" environment="soft" fog><Daylight time={night ? 21 : 13} /></Scene>
 */
export function Daylight({
  time,
  transition = 1.5,
  background = true,
  north = 0,
  keys = DAY,
  sunrise = 6,
  sunset = 19,
  strength,
}: DaylightProps) {
  const scene = useScene();
  const [sun] = useState(() => new THREE.DirectionalLight());
  const [fill] = useState(() => new THREE.HemisphereLight());
  useAttach(sun);
  useAttach(fill);
  useAttach(sun.target);

  // Restore the background and fog colour on unmount.
  useEffect(() => {
    const root = scene.scene;
    const before = root.background;
    const fog = root.fog instanceof THREE.Fog ? root.fog.color.clone() : null;
    return () => {
      root.background = before;
      currentLight.delete(scene);
      if (fog && root.fog instanceof THREE.Fog) root.fog.color.copy(fog);
      scene.invalidate();
    };
  }, [scene]);

  // A separate Color, so the background object this replaces is left unchanged.
  const [sky] = useState(() => new THREE.Color());

  useDriven(time, transition, (hour) => {
    const light = daylightAt(hour, keys, north, { sunrise, sunset });
    sun.position.copy(light.sunDirection).multiplyScalar(100);
    sun.color.copy(light.sun);
    // Sky light (the fill and the environment) fills in shadows, so with shadows on, move light
    // from the sky to the sun. Overall brightness stays about the same.
    const shadows = scene.shadows !== null;
    const { key, sky: fillIntensity } = shadows
      ? shadowBalance(light.sunIntensity, light.fillIntensity, light.direct)
      : { key: light.sunIntensity, sky: light.fillIntensity };
    sun.intensity = (shadows ? key * 1.3 : key) * (strength?.sun ?? 1);
    fill.color.copy(light.sky);
    fill.groundColor.copy(light.ground);
    fill.intensity = fillIntensity * (strength?.sky ?? 1);
    const peak = Math.max(...keys.map((k) => k.sunIntensity));
    currentLight.set(scene, { ...light, hour, level: peak > 0 ? light.sunIntensity / peak : 0 });
    // One more frame for useDaylight readers that ran before this update.
    scene.invalidate();
    const root = scene.scene;
    // A transparent scene shows the views behind it instead of a sky.
    if (background && !scene.transparent) {
      root.background = sky.copy(light.background);
      if (root.fog instanceof THREE.Fog) root.fog.color.copy(light.background);
    }
    const environment = (root as unknown as { environmentNode: unknown }).environmentNode;
    if (environment instanceof StudioEnvironmentNode)
      environment.light.gain.value = shadows ? light.reflections * 0.5 : light.reflections;
  });
  return null;
}
