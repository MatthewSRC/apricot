// Entry point @apricotjs/react-native/model. It is separate from @apricotjs/react-native so
// that apps that never load a model do not bundle three's GLTFLoader.

import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import type * as THREE from "three/webgpu";
import type { Animatable } from "./animatable";
import { useScene } from "./context";
import type { ModelKit } from "./kit";
import type { MaterialInput, MaterialOverrides } from "./materials";
import type { ModelSource } from "./model/files";
import { ModelBody } from "./model/ModelBody";
import { copyOf, keyOf, modelCache, NO_CLIPS, sourceOf, useModel } from "./model/models";
import {
  ClipDriver,
  type ClipInput,
  JointDriver,
  type JointInput,
  MorphDriver,
  PartInspector,
  type PartPressEvent,
  useClipPlayer,
  usePartPress,
} from "./modelParts";
import { ParentContext, type SceneObject } from "./parent";
import type { ShadowProps } from "./shadow";
import type { TransformProps } from "./transform";

export interface ModelProps<P extends string = string> extends TransformProps, ShadowProps {
  /** The .glb file to show. Alternatively give `kit`. */
  src?: ModelSource;
  /** A model kit: the model plus names for its parts. See defineModelKit. */
  kit?: ModelKit<P>;
  /**
   * Materials for parts, keyed by kit part name or selector
   * ("material:car_paint*", "ruota_*", "tag:glass"). Each value is a preset
   * name, a preset with options, or a three.js material. Colour changes
   * animate.
   *
   *   materials={{ paint: { preset: "car-paint", color }, "glass*": "tinted-glass" }}
   */
  materials?: Partial<Record<P | (string & {}), MaterialInput>>;
  /**
   * Moving parts, from 0 (rest) to 1 (open), keyed by kit joint name, or by
   * selector with the hinge given inline. Plain numbers animate; shared
   * values are followed exactly.
   *
   *   joints={{ doorLeft: open ? 1 : 0, "node:Lid": { value: lid, hinge: "bottom-back", axis: "x", range: [0, -110] } }}
   */
  joints?: Partial<Record<P | (string & {}), JointInput>>;
  /** Animation clips by name: a progress from 0 to 1 to scrub, "once" or "loop". */
  animations?: Record<string, ClipInput>;
  /**
   * Shape keys (morph targets) by name, from 0 (off) to 1 (full). Plain
   * numbers animate; shared values are followed exactly.
   */
  morphs?: Record<string, Animatable<number>>;
  /** Called when a part of the model is tapped. */
  onPartPress?: (event: PartPressEvent<P>) => void;
  /** Tap parts to highlight them and show their names and materials. For development. */
  inspect?: boolean;
  /**
   * Stands the model on the floor: moves it up or down so its lowest point
   * is at y = 0, wherever its origin is. Measured once, at rest.
   */
  ground?: boolean;
  /**
   * When `src` changes, keeps showing the current model while the next one
   * loads and its shaders compile, then swaps them in one frame. Children
   * stay and move to the new model; a <CameraRig> inside it flies to frame
   * the new model over its `transition`. With false, the current model is
   * removed at once and the next one appears when ready. Default true.
   */
  keepPrevious?: boolean;
  ref?: Ref<SceneObject>;
  /** Called when the model has loaded. With keepPrevious, this is before it is shown; see onReady. */
  onLoad?: (object: THREE.Group) => void;
  /**
   * Called when the model is on screen: loaded, its shaders compiled and
   * drawn, with the `src` it was loaded from. Called again for each new
   * `src`, though sources replaced before they finish loading are skipped.
   * Use it to fade in, take a picture or hide a spinner.
   */
  onReady?: (object: THREE.Group, src: ModelSource) => void;
  /** Called when the model fails to load. Without it, the error is logged. */
  onError?: (error: Error) => void;
  children?: ReactNode;
}

interface Shown {
  object: THREE.Group;
  clips: THREE.AnimationClip[];
  key: string;
}

/**
 * A glTF binary model. Use `.glb` files with quantized meshes and PNG or
 * JPEG textures, since Hermes cannot run Draco, meshopt or KTX2 decoders.
 * `npx apricot-models` from @apricotjs/metro converts models to this format.
 */
export function Model<P extends string = string>({
  src,
  kit,
  materials,
  joints,
  animations,
  morphs,
  onPartPress,
  inspect = false,
  ground = false,
  keepPrevious = true,
  ref,
  onLoad,
  onReady,
  onError,
  children,
  castShadow,
  receiveShadow,
  shadowOnly,
  ...transform
}: ModelProps<P>) {
  const source = src ?? kit?.src;
  if (source === undefined) throw new Error("<Model> needs `src` or `kit`");
  const key = keyOf(source);
  const { object, animations: clips, error } = useModel(source);
  const loaded: Shown | null = object ? { object, clips, key: copyOf.get(object) ?? key } : null;
  // The copy on screen. With keepPrevious, `incoming` is the next copy while it is prepared.
  const [shown, setShown] = useState<Shown | null>(loaded);
  if (keepPrevious ? !shown && loaded : shown?.object !== loaded?.object) setShown(loaded);
  // A copy of the model already shown, after `src` was set back to it, is not swapped in.
  const incoming = keepPrevious && loaded && shown && loaded.key !== shown.key ? loaded : null;
  const latestIncoming = useRef(incoming);
  latestIncoming.current = incoming;
  // Swaps in a prepared copy if it is still the incoming one.
  const ready = (next: THREE.Group) => {
    const now = latestIncoming.current;
    if (now?.object === next) setShown(now);
  };
  // The shown model stays in the cache until it is swapped out, since useModel releases it when `src` changes.
  const shownKey = shown?.key;
  useEffect(() => {
    if (shownKey === undefined) return;
    modelCache.acquire(shownKey).catch(() => {});
    return () => modelCache.release(shownKey);
  }, [shownKey]);
  const main = shown?.object ?? null;
  const player = useClipPlayer(main, shown?.clips ?? NO_CLIPS);
  usePartPress(main, kit, onPartPress as ((event: PartPressEvent) => void) | undefined);
  const callbacks = useRef({ onLoad, onReady, onError });
  callbacks.current = { onLoad, onReady, onError };
  const scene = useScene();
  const startedAt = useRef(scene.diagnostics.time());
  // biome-ignore lint/correctness/useExhaustiveDependencies: logged once per loaded object
  useEffect(() => {
    if (!object) return;
    scene.diagnostics.note("model loaded", {
      src: typeof source === "number" ? `asset ${source}` : source,
      ms: Math.round(scene.diagnostics.time() - startedAt.current),
    });
    callbacks.current.onLoad?.(object);
  }, [object]);
  // Load time is measured from when `src` changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `src`
  useEffect(() => {
    startedAt.current = scene.diagnostics.time();
  }, [key]);
  useEffect(() => {
    if (!main || shownKey === undefined) return;
    let cancelled = false;
    void scene.drawn().then(() => {
      if (!cancelled) callbacks.current.onReady?.(main, sourceOf(shownKey));
    });
    return () => {
      cancelled = true;
    };
  }, [main, shownKey, scene]);
  useEffect(() => {
    if (!error) return;
    if (callbacks.current.onError) callbacks.current.onError(error);
    else console.error("[apricot] Model failed to load:", error);
  }, [error]);
  if (!shown || !main) return null;
  const body = (copy: Shown, next: boolean) => (
    <ModelBody
      key={copy.object.uuid}
      object={copy.object}
      kit={kit}
      materials={materials as MaterialOverrides | undefined}
      ground={ground}
      transform={transform}
      objectRef={next ? undefined : ref}
      next={next}
      ready={ready}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      shadowOnly={shadowOnly}
    />
  );
  return (
    <>
      {incoming ? [body(shown, false), body(incoming, true)] : [body(shown, false)]}
      {/* Children and part drivers attach to the shown model, so they stay when it is swapped. */}
      <ParentContext.Provider value={main}>
        {Object.entries(joints ?? {}).map(([name, input]) => (
          <JointDriver key={name} object={main} kit={kit} name={name} input={input as JointInput} />
        ))}
        {Object.entries(animations ?? {}).map(([name, input]) => (
          <ClipDriver key={name} player={player} name={name} input={input} />
        ))}
        {Object.entries(morphs ?? {}).map(([name, input]) => (
          <MorphDriver key={name} object={main} name={name} input={input} />
        ))}
        {inspect ? <PartInspector object={main} kit={kit} /> : null}
        {children}
      </ParentContext.Provider>
    </>
  );
}

export { defineModelKit, type JointPart, type KitPart, type ModelKit } from "./kit";
export {
  download,
  forgetDownloads,
  isDownloaded,
  loadModelBytes,
  type ModelSource,
} from "./model/files";
export { measureModel, modelCache, useModel } from "./model/models";
export { type TextureState, textureCache, useTexture, useTextureState } from "./model/textures";
export type { ClipInput, JointInput, PartPressEvent } from "./modelParts";
