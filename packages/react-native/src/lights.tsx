import type { Vec3 } from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useState } from "react";
import * as THREE from "three/webgpu";
import { type Animatable, useAnimatable } from "./animatable";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { type SceneObject, useAttach } from "./parent";
import { useShadowChoice } from "./shadow";
import { type TransformProps, useTransform } from "./transform";

// Lights that add to the scene's look, or replace it with look="none". Position, intensity and
// target accept shared values, so lights can move and dim every frame without React renders.

interface LightProps {
  /** Colour of the light (default white). */
  color?: THREE.ColorRepresentation;
  /** Brightness (default 1). Accepts a shared value. */
  intensity?: Animatable<number>;
}

/** Keeps a light's colour and intensity in sync with props, and attaches it. */
const useLight = (light: THREE.Light, { color = "#ffffff", intensity = 1 }: LightProps) => {
  const scene = useScene();
  useEffect(() => {
    light.color.set(color);
    scene.invalidate();
  }, [light, color, scene]);
  const read = useAnimatable(intensity);
  useFrame(() => {
    light.intensity = read();
  });
  useAttach(light);
};

/** Keeps the `target` of a directional or spot light in sync with props. */
const useTarget = (light: THREE.DirectionalLight | THREE.SpotLight, target: Animatable<Vec3>) => {
  const read = useAnimatable(target);
  useAttach(light.target);
  useFrame(() => {
    const [x, y, z] = read();
    light.target.position.set(x, y, z);
  });
};

export interface AmbientLightProps extends LightProps {
  ref?: Ref<SceneObject>;
}

/** Light from every direction with no shading, which lifts shadows evenly. */
export function AmbientLight({ ref, ...props }: AmbientLightProps) {
  const [light] = useState(() => new THREE.AmbientLight());
  useImperativeHandle(ref, () => light, [light]);
  useLight(light, props);
  return null;
}

export interface HemisphereLightProps extends LightProps {
  /** Colour of the light from above (default white). */
  sky?: THREE.ColorRepresentation;
  /** Colour of the light from below (default a warm grey). */
  ground?: THREE.ColorRepresentation;
  ref?: Ref<SceneObject>;
}

/** Soft outdoor light: one colour from the sky and another bounced from the ground. */
export function HemisphereLight({
  sky = "#ffffff",
  ground = "#8a7a6a",
  ref,
  ...props
}: HemisphereLightProps) {
  const scene = useScene();
  const [light] = useState(() => new THREE.HemisphereLight());
  useImperativeHandle(ref, () => light, [light]);
  useLight(light, { ...props, color: sky });
  useEffect(() => {
    light.groundColor.set(ground);
    scene.invalidate();
  }, [light, ground, scene]);
  return null;
}

export interface DirectionalLightProps extends LightProps, Pick<TransformProps, "position"> {
  /** The point it shines towards (default the origin). Accepts a shared value. */
  target?: Animatable<Vec3>;
  /**
   * In a scene with `shadows`, true makes this the light that casts them and
   * false stops it from casting them. By default the brightest directional
   * light casts shadows.
   */
  castShadow?: boolean;
  ref?: Ref<SceneObject>;
}

/** Sunlight: parallel rays from `position` towards `target`. */
export function DirectionalLight({
  position = [3, 5, 4],
  target = [0, 0, 0],
  castShadow,
  ref,
  ...props
}: DirectionalLightProps) {
  const [light] = useState(() => new THREE.DirectionalLight());
  const [shadowed] = useState(() => [light]);
  useShadowChoice(shadowed, { castShadow });
  useImperativeHandle(ref, () => light, [light]);
  useLight(light, props);
  useTransform(light, { position });
  useTarget(light, target);
  return null;
}

export interface PointLightProps extends LightProps, Pick<TransformProps, "position"> {
  /** Range (default 0: unlimited, fading with distance). */
  distance?: number;
  ref?: Ref<SceneObject>;
}

/** A bulb: light in every direction from `position`. */
export function PointLight({ distance = 0, ref, position = [0, 2, 0], ...props }: PointLightProps) {
  const [light] = useState(() => new THREE.PointLight());
  light.distance = distance;
  useImperativeHandle(ref, () => light, [light]);
  useLight(light, props);
  useTransform(light, { position });
  return null;
}

export interface SpotLightProps extends Omit<PointLightProps, "ref"> {
  /** The point it shines towards (default the origin). Accepts a shared value. */
  target?: Animatable<Vec3>;
  /** Half-angle of the cone, in radians (default 0.5). */
  angle?: number;
  /** Softness of the cone's edge, from 0 to 1 (default 0.3). */
  penumbra?: number;
  ref?: Ref<SceneObject>;
}

/** A spotlight: a cone of light from `position` towards `target`. */
export function SpotLight({
  distance = 0,
  angle = 0.5,
  penumbra = 0.3,
  position = [0, 4, 2],
  target = [0, 0, 0],
  ref,
  ...props
}: SpotLightProps) {
  const [light] = useState(() => new THREE.SpotLight());
  light.distance = distance;
  light.angle = angle;
  light.penumbra = penumbra;
  useImperativeHandle(ref, () => light, [light]);
  useLight(light, props);
  useTransform(light, { position });
  useTarget(light, target);
  return null;
}
