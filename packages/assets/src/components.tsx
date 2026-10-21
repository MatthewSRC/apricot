import { disposeObject } from "@apricotjs/core";
import {
  NO_BOUNDS,
  Primitive,
  type SceneObject,
  type TransformProps,
  useBounds,
  useScene,
} from "@apricotjs/react-native";
import { useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import { type CarOptions, createCar } from "./car";
import { type CardOptions, createCard, setCardFinish } from "./card";
import { type AppleOptions, createApple, createPeach, type PeachOptions } from "./fruit";
import { type CoinOptions, createCoin, createMoneyStack, type MoneyStackOptions } from "./money";
import {
  type BackdropOptions,
  type ContactShadowOptions,
  createBackdrop,
  createContactShadow,
  createGround,
  createTrees,
  type GroundOptions,
  type TreesOptions,
} from "./scenery";
import { createStudioFloor, type StudioFloorOptions } from "./showroom";

/** A stack of banknotes drawn in one draw call, with its base at y = 0. */
export function MoneyStack({
  bills,
  seed,
  width,
  depth,
  thickness,
  band,
  colors,
  ...transform
}: MoneyStackOptions & TransformProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: colors is compared by content
  const stack = useMemo(
    () => createMoneyStack({ bills, seed, width, depth, thickness, band, colors }),
    [bills, seed, width, depth, thickness, band, JSON.stringify(colors)],
  );
  useEffect(() => () => disposeObject(stack), [stack]);
  return <Primitive object={stack} {...transform} />;
}

/** A gold coin lying flat. */
export function Coin({ radius, thickness, color, ...transform }: CoinOptions & TransformProps) {
  const coin = useMemo(() => createCoin({ radius, thickness, color }), [radius, thickness, color]);
  useEffect(() => () => disposeObject(coin), [coin]);
  return <Primitive object={coin} {...transform} />;
}

/** An emoji-style peach, Apricot's mascot. Drawn in two draw calls. */
export function Peach({ size, leaves, detail, ...transform }: PeachOptions & TransformProps) {
  const peach = useMemo(() => createPeach({ size, leaves, detail }), [size, leaves, detail]);
  useEffect(() => () => disposeObject(peach), [peach]);
  return <Primitive object={peach} {...transform} />;
}

/** An emoji-style apple drawn in one draw call. Use it alone or as a <Pile> item. */
export function Apple({ size, color, leaf, ...transform }: AppleOptions & TransformProps) {
  const apple = useMemo(() => createApple({ size, color, leaf }), [size, color, leaf]);
  useEffect(() => () => disposeObject(apple), [apple]);
  return <Primitive object={apple} {...transform} />;
}

/** An emoji-style toy car facing +z. Its wheels steer and spin inside a <Vehicle>. */
export function Car({ color, glass, ...transform }: CarOptions & TransformProps) {
  const car = useMemo(() => createCar({ color, glass }), [color, glass]);
  useEffect(() => () => disposeObject(car), [car]);
  return <Primitive object={car} {...transform} />;
}

/**
 * Scattered trees, drawn in two draw calls for the whole forest.
 * `scale` is the random size range of the trees, not a transform.
 */
export function Trees({
  count,
  area,
  clearing,
  scale,
  seed,
  ...transform
}: TreesOptions & Omit<TransformProps, "scale">) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: arrays are compared by content
  const trees = useMemo(
    () => createTrees({ count, area, clearing, scale, seed }),
    [count, JSON.stringify(area), clearing, JSON.stringify(scale), seed],
  );
  useEffect(() => () => disposeObject(trees), [trees]);
  return <Primitive object={trees} {...transform} />;
}

/** A flat checkered ground at y = 0. */
export function Ground({ size, tile, colors, ...transform }: GroundOptions & TransformProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: colors is compared by content
  const ground = useMemo(() => createGround({ size, tile, colors }), [size, tile, JSON.stringify(colors)]);
  useEffect(() => () => disposeObject(ground), [ground]);
  return <Primitive object={ground} {...transform} />;
}

export interface ContactShadowProps extends ContactShadowOptions, TransformProps {
  /**
   * Object to fit the shadow to. The shadow is sized to its footprint, placed at its base and
   * refitted whenever its bounds change. Without it, the shadow uses `width`, `length` and the transform.
   */
  under?: SceneObject | null;
  /** Shadow size relative to the footprint of `under` (default 1.15). */
  spread?: number;
}

/** A soft shadow under an object. Put it inside the object's group. */

export function ContactShadow({
  width,
  length,
  opacity,
  under,
  spread = 1.15,
  ...transform
}: ContactShadowProps) {
  const scene = useScene();
  const fitted = under !== undefined;
  const shadow = useMemo(() => {
    const made = createContactShadow({ width: fitted ? 1 : width, length: fitted ? 1 : length, opacity });
    // Excluded from bounds so it does not change the size of the object it sits under.
    made.userData[NO_BOUNDS] = true;
    return made;
  }, [fitted, width, length, opacity]);
  useEffect(() => () => disposeObject(shadow), [shadow]);
  const bounds = useBounds(fitted ? under : null);
  useEffect(() => {
    if (!fitted) return;
    shadow.visible = bounds !== null;
    if (bounds) {
      // The base of `under`, converted to the local space of the shadow's parent.
      const at = new THREE.Vector3(bounds.center[0], bounds.min[1] + 0.003, bounds.center[2]);
      shadow.parent?.updateWorldMatrix(true, false);
      shadow.parent?.worldToLocal(at);
      shadow.position.copy(at);
      shadow.scale.set(Math.max(bounds.size[0], 1e-3) * spread, 1, Math.max(bounds.size[2], 1e-3) * spread);
    }
    scene.invalidate();
  }, [fitted, bounds, shadow, spread, scene]);
  return <Primitive object={shadow} {...(fitted ? {} : transform)} />;
}

/**
 * A payment card with its front facing +z, in one of CARD_FINISHES.
 * Changing `finish` or `art` swaps the materials without rebuilding the card.
 */
export function Card({
  finish = "brushed-steel",
  art = null,
  chip,
  ...transform
}: CardOptions & TransformProps) {
  const card = useMemo(() => createCard({ chip }), [chip]);
  useEffect(() => {
    setCardFinish(card, finish, art);
  }, [card, finish, art]);
  useEffect(() => () => disposeObject(card), [card]);
  return <Primitive object={card} {...transform} />;
}

/** A studio backdrop to place behind a product. Transmissive materials need one to show refraction. */
export function Backdrop({ size, colors, lines, ...transform }: BackdropOptions & TransformProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: arrays are compared by content
  const backdrop = useMemo(
    () => createBackdrop({ size, colors, lines }),
    [JSON.stringify(size), JSON.stringify(colors), lines],
  );
  useEffect(() => () => disposeObject(backdrop), [backdrop]);
  return <Primitive object={backdrop} {...transform} />;
}

/** A round studio floor that fades into the background, at y = 0. */
export function StudioFloor({ radius, colors, ...transform }: StudioFloorOptions & TransformProps) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: arrays are compared by content
  const floor = useMemo(() => createStudioFloor({ radius, colors }), [radius, JSON.stringify(colors)]);
  useEffect(() => () => disposeObject(floor), [floor]);
  return <Primitive object={floor} {...transform} />;
}
