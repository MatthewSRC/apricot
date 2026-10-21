import {
  beamEnd,
  beamStrength,
  createLightBeamGeometry,
  createLightBeamMaterial,
  type LightBeamOptions,
  setShadow,
  type Vec3,
} from "@apricotjs/core";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three/webgpu";
import { useScene } from "./context";
import { useDaylight } from "./Daylight";
import { useFrame } from "./hooks";
import { type SceneObject, useAttach } from "./parent";

export interface LightBeamProps extends LightBeamOptions {
  /** Centre of the opening where the light comes in, such as a window, in metres. */
  from: Vec3;
  /** Centre of where the beam ends, such as on the floor. Sets its length and slant. Not needed with `sun`. */
  to?: Vec3;
  /**
   * Follows the scene's <Daylight>. The beam comes in along the sun's (or
   * moon's) rays and ends where they land, on the floor or on a wall of
   * `bounds`. It takes the light's colour and brightness (`intensity` at the
   * brightest), and shows only while the light falls on the opening's side of
   * the wall.
   */
  sun?: boolean;
  /** With `sun`: the walls the beam may end on, as [minX, minZ, maxX, maxZ] (default: the floor only). */
  bounds?: readonly [number, number, number, number];
  /** With `sun`: the height of the floor (default 0). */
  floor?: number;
  /** Width and height of the opening, in metres. */
  size: readonly [number, number];
  /**
   * The direction the opening faces into the room, such as [1, 0, 0] for a
   * window in a wall facing +x. Defaults to level towards `to`, or along the
   * beam if it falls straight down, as from a skylight. The beam keeps the
   * opening's rectangle along its whole length.
   */
  facing?: Vec3;
  ref?: Ref<SceneObject>;
}

const up = new THREE.Vector3(0, 1, 0);

/**
 * A beam of light through dusty air, such as sunlight through a window or a
 * spotlight's cone on a stage. It is a soft transparent volume that adds
 * light, brightest at the opening and fading along its length and towards its
 * edges. Pair it with a light that shines the same way, such as a
 * <DirectionalLight> through the window, for the bright patch where it lands.
 *
 *   <LightBeam from={[2, 1.4, -0.4]} to={[0.4, 0, 0.6]} size={[0.9, 1.1]} facing={[-1, 0, 0]} />
 *   <LightBeam sun from={[2, 1.4, -0.4]} size={[0.9, 1.1]} facing={[-1, 0, 0]} bounds={[-2, -1.5, 2, 1.5]} />
 */
export function LightBeam({
  from,
  to,
  size,
  facing,
  color,
  intensity = 1,
  reach,
  sun = false,
  bounds,
  floor = 0,
  ref,
}: LightBeamProps) {
  const scene = useScene();
  const [geometry] = useState(createLightBeamGeometry);
  // Colour, brightness and reach can change without a new shader, so one material lasts its lifetime.
  const [beam] = useState(() => createLightBeamMaterial({ color, intensity, reach }));
  const [mesh] = useState(() => {
    const created = new THREE.Mesh(geometry);
    created.name = "LightBeam";
    created.matrixAutoUpdate = false;
    // The beam is light, not an object: it has no shadow and cannot be tapped.
    setShadow(created, { cast: false, receive: false });
    created.raycast = () => {};
    return created;
  });
  mesh.material = beam.material;
  useEffect(() => {
    // With `sun`, colour and brightness come from the daylight in the frame callback below.
    beam.set(sun ? { reach } : { color, intensity, reach });
    scene.invalidate();
  }, [beam, sun, color, intensity, reach, scene]);
  useEffect(
    () => () => {
      geometry.dispose();
      beam.material.dispose();
    },
    [geometry, beam],
  );

  // The geometry is a unit box (1 × 1 across, z from 0 to 1). Its matrix maps x and y onto the
  // opening and z onto the beam's length.
  const [fx, fy, fz] = from;
  const [width, height] = size;
  const place = (end: Vec3) => {
    const [tx, ty, tz] = end;
    const [nx, ny, nz] = facing ?? [tx - fx, 0, tz - fz];
    const along = new THREE.Vector3(tx - fx, ty - fy, tz - fz);
    const normal = new THREE.Vector3(nx, ny, nz).normalize();
    // A beam falling straight down has no level direction, so face along the beam, as a skylight does.
    if (normal.lengthSq() < 1e-6) normal.copy(along).normalize();
    const across = new THREE.Vector3().crossVectors(up, normal).normalize();
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    const upright = new THREE.Vector3().crossVectors(normal, across).normalize();
    mesh.matrix.makeBasis(across.multiplyScalar(width), upright.multiplyScalar(height), along);
    mesh.matrix.setPosition(fx, fy, fz);
    mesh.matrixWorldNeedsUpdate = true;
    scene.invalidate();
  };
  const latest = useRef(place);
  latest.current = place;
  const [tx, ty, tz] = to ?? from;
  const [nx, ny, nz] = facing ?? [0, 0, 0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the opening's place and shape are the triggers (read through `latest`)
  useEffect(() => {
    if (!sun) latest.current([tx, ty, tz]);
  }, [sun, fx, fy, fz, tx, ty, tz, width, height, nx, ny, nz]);

  // With `sun`, place the beam again when the hour or the beam's props change.
  const daylight = useDaylight();
  const shown = useRef("");
  const key = `${from}|${size}|${facing}|${bounds}|${floor}|${intensity}`;
  useFrame(() => {
    if (!sun) return false;
    const light = daylight();
    if (!light) return false;
    const seen = `${key}|${light.hour}`;
    if (shown.current === seen) return false;
    shown.current = seen;
    const d = light.sunDirection;
    const along: Vec3 = [-d.x, -d.y, -d.z];
    const end = beamEnd(from, along, { floor, bounds });
    const opening: Vec3 = facing ?? [along[0], 0, along[2]];
    const strength = end ? beamStrength(opening, along) * light.level : 0;
    latest.current(end ?? [fx + along[0], fy + along[1], fz + along[2]]);
    beam.set({ color: light.sun, intensity: intensity * strength });
    // Request one more frame, since the loop may sleep once the daylight has settled.
    return true;
  });

  useImperativeHandle(ref, () => mesh, [mesh]);
  useAttach(mesh);
  return null;
}
