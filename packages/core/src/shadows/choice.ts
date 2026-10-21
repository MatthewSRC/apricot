import * as THREE from "three/webgpu";
import { materialsOf } from "../parts";

/** A mesh's own shadow settings, overriding the defaults (see setShadow). */
export interface ShadowChoice {
  cast?: boolean;
  receive?: boolean;
  /** Not drawn, only casting its shadow (a roof over a cut-away room, a tree off screen). */
  only?: boolean;
}

/** The layer for shadow-only meshes. Cameras do not draw it; lights that cast shadows see it. */
export const SHADOW_ONLY_LAYER = 30;

const KEY = "apricot:shadow";

/**
 * Sets whether `object` casts and receives shadows, overriding the defaults:
 * meshes cast and receive, flat ones only receive, and see-through ones do
 * neither. On a directional light, `cast: true` makes it the light that
 * casts. `only: true` hides a mesh from cameras but keeps its shadow, in a
 * scene with shadows.
 */
export const setShadow = (object: THREE.Object3D, choice: ShadowChoice | undefined) => {
  if (choice) object.userData[KEY] = choice;
  else delete object.userData[KEY];
  if (choice?.only) object.layers.set(SHADOW_ONLY_LAYER);
  else if (object.layers.mask === 1 << SHADOW_ONLY_LAYER) object.layers.set(0);
};

/** The choice set on `object` with setShadow, if any. */
export const choiceOf = (object: THREE.Object3D): ShadowChoice | undefined => object.userData[KEY];

const seeThrough = (mesh: THREE.Mesh) =>
  materialsOf(mesh).some(
    (m) => (m.transparent && m.opacity < 0.99) || ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0,
  );

const size = new THREE.Vector3();
/** Thinner than 1% of its width: a floor, a plane, a decal. */
const isFlat = (mesh: THREE.Mesh) => {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  (geometry.boundingBox as THREE.Box3).getSize(size).multiply(mesh.scale);
  const sides = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)].sort((a, b) => a - b);
  return sides[0] <= sides[2] * 0.01;
};

/** Whether a mesh casts and receives shadows, by its own choice or by default. */
export const shadowOf = (mesh: THREE.Mesh) => {
  const choice = choiceOf(mesh);
  const clear = seeThrough(mesh);
  return {
    cast: choice?.only ? true : (choice?.cast ?? (!clear && !isFlat(mesh))),
    receive: choice?.only ? false : (choice?.receive ?? !clear),
  };
};

// The result of shadowOf for a mesh, with the inputs it depends on.
interface Decision {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  choice: ShadowChoice | undefined;
  sx: number;
  sy: number;
  sz: number;
  // The transparency of a single material.
  transparent: boolean;
  opacity: number;
  cast: boolean;
  receive: boolean;
}
const decisions = new WeakMap<THREE.Mesh, Decision>();

/** shadowOf, cached per mesh until its inputs change. Called for every mesh every frame. */
export const decide = (mesh: THREE.Mesh) => {
  const d = decisions.get(mesh);
  const m = mesh.material as THREE.Material;
  if (
    d &&
    d.geometry === mesh.geometry &&
    d.material === mesh.material &&
    d.choice === choiceOf(mesh) &&
    d.sx === mesh.scale.x &&
    d.sy === mesh.scale.y &&
    d.sz === mesh.scale.z &&
    (Array.isArray(mesh.material) || (d.transparent === m.transparent && d.opacity === m.opacity))
  )
    return d;
  const { cast, receive } = shadowOf(mesh);
  const next: Decision = {
    geometry: mesh.geometry,
    material: mesh.material,
    choice: choiceOf(mesh),
    sx: mesh.scale.x,
    sy: mesh.scale.y,
    sz: mesh.scale.z,
    transparent: m.transparent,
    opacity: m.opacity,
    cast,
    receive,
  };
  decisions.set(mesh, next);
  return next;
};
