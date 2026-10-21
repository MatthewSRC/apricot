import { type Ref, useEffect, useMemo, useRef } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "../context";
import { Group, Primitive } from "../Group";
import { type ModelKit, resolvePart } from "../kit";
import { type MaterialOverrides, useMaterialOverrides } from "../materials";
import type { SceneObject } from "../parent";
import { type ShadowProps, useShadowChoice } from "../shadow";
import type { TransformProps } from "../transform";

interface ModelBodyProps extends ShadowProps {
  object: THREE.Group;
  kit: ModelKit<string> | undefined;
  materials: MaterialOverrides | undefined;
  ground: boolean;
  transform: TransformProps;
  objectRef?: Ref<SceneObject>;
  /** Whether this is the incoming model, prepared out of sight. `ready` is called once its shaders are compiled. */
  next: boolean;
  ready: (object: THREE.Group) => void;
}

/** The box around `object` in its own space, as loaded and before it is placed. */
const restingBounds = (object: THREE.Object3D) => {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  return box.applyMatrix4(object.matrixWorld.clone().invert());
};

/** One copy of a model in the scene: the shown one, or the incoming one being prepared (see keepPrevious). */
export function ModelBody({
  object,
  kit,
  materials,
  ground,
  transform,
  objectRef,
  next,
  ready,
  castShadow,
  receiveShadow,
  shadowOnly,
}: ModelBodyProps) {
  useMaterialOverrides(object, materials, (key) => resolvePart(kit, key));
  // Shadow settings apply to every mesh of the model, unless a part sets its own.
  const meshes = useMemo(() => {
    const found: THREE.Object3D[] = [];
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o);
    });
    return found;
  }, [object]);
  useShadowChoice(meshes, { castShadow, receiveShadow, shadowOnly });
  const scene = useScene();
  const latestReady = useRef(ready);
  latestReady.current = ready;
  // Held out of frames until its shaders are compiled, then swapped in for the shown model.
  useEffect(() => {
    if (!next) return;
    const show = scene.holdBack(object);
    let cancelled = false;
    void scene.compiled(object).then(() => {
      if (!cancelled) latestReady.current(object);
    });
    return () => {
      cancelled = true;
      show();
    };
  }, [next, object, scene]);
  const lift = useMemo(() => (ground ? -restingBounds(object).min.y : 0), [ground, object]);
  // A grounded model is lifted inside a group, which takes the transform and the ref.
  return ground ? (
    <Group ref={objectRef} {...transform}>
      <Primitive object={object} position={[0, lift, 0]} />
    </Group>
  ) : (
    <Primitive object={object} ref={objectRef} {...transform} />
  );
}
