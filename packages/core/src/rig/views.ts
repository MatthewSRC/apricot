export type V3 = readonly [number, number, number];

/**
 * A camera position given as an orbit around a target, in degrees.
 * `azimuth` 0 puts the camera on +z looking at the front; 90 puts it on +x.
 * `elevation` 90 looks straight down. Without `distance`, the camera backs
 * off until the subject fits. `position` gives an exact camera position
 * instead of the angles.
 */
export interface CameraView {
  azimuth?: number;
  elevation?: number;
  distance?: number;
  /** The point looked at. Defaults to the followed object, else the subject's centre, else the current target. */
  target?: V3;
  position?: V3;
  /** Vertical field of view in degrees. Defaults to the camera's own. */
  fov?: number;
}

/** The views every rig knows by name. */
export const CAMERA_VIEWS = {
  front: { azimuth: 0, elevation: 8 },
  back: { azimuth: 180, elevation: 8 },
  left: { azimuth: 90, elevation: 8 },
  right: { azimuth: -90, elevation: 8 },
  top: { azimuth: 0, elevation: 90 },
  "three-quarter": { azimuth: 35, elevation: 16 },
} satisfies Record<string, CameraView>;

export type CameraViewName = keyof typeof CAMERA_VIEWS;

/** Looks up a view by name in `extra`, then in CAMERA_VIEWS. Throws for an unknown name. */
export const findView = (name: string, extra?: Record<string, CameraView>): CameraView => {
  const found = extra?.[name] ?? (CAMERA_VIEWS as Record<string, CameraView>)[name];
  if (!found) {
    const names = [...Object.keys(CAMERA_VIEWS), ...Object.keys(extra ?? {})];
    throw new Error(`Unknown camera view "${name}". Known: ${names.join(", ")}`);
  }
  return found;
};
