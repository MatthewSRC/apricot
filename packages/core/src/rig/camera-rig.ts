import * as THREE from "three/webgpu";
import {
  boxToFit,
  type CameraFit,
  cameraBasis,
  fitBoxDistance,
  type Inset,
  lerpInset,
  NO_INSET,
} from "./framing";
import { clampElevation, DEG, easeInOut, shortestTurn } from "./maths";
import {
  FLICK_DECAY,
  FLICK_HOLD_MS,
  FLICK_STOP_SPEED,
  type OrbitLimits,
  type OrbitOptions,
  orbitLimits,
  pinchSpan,
  type TouchPoint,
  within,
} from "./orbit";
import { type SwayOptions, Swing, sameSway } from "./sway";
import { CAMERA_VIEWS, type CameraView, findView } from "./views";

export interface CameraRigOptions {
  /** Extra room around the subject when fitting, as a fraction (default 0.1). */
  margin?: number;
  /** Extra named views, added to CAMERA_VIEWS. */
  views?: Record<string, CameraView>;
  /** Clock in milliseconds, used for `returnAfter` (default performance.now). */
  now?: () => number;
}

interface Pose {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
  fov: number;
}

interface Followed {
  object: THREE.Object3D;
  /** From the object's origin to the point to aim at. */
  offset: THREE.Vector3;
  /** Where the camera aims. It eases towards the object's aim point. */
  aim: THREE.Vector3;
  /** The object's aim point on the previous step, or null before the first. */
  last: THREE.Vector3 | null;
}

interface Gesture {
  points: TouchPoint[];
  time: number;
  /** Total finger travel in points. */
  moved: number;
  limits: OrbitLimits;
}

interface Tween<T> {
  from: T;
  to: T;
  elapsed: number;
  duration: number;
}

/** Distance used when there is no subject to fit. */
const DEFAULT_DISTANCE = 6;

const still = () => ({ azimuth: 0, elevation: 0 });

/**
 * Moves a camera between views on arcs around the subject, so it swings
 * around a car instead of cutting through it. Fits the subject in the part
 * of the screen not covered by UI (`inset`), at any screen size.
 */
export class CameraRig {
  /** Degrees per second the camera slowly circles the subject (0 = still). */
  drift = 0;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly options: CameraRigOptions;
  private readonly now: () => number;
  /** The camera's own clipping range. The rig widens it for far views but never narrows it. */
  private readonly baseNear: number;
  private readonly baseFar: number;

  private subject: THREE.Box3 | null = null;
  private inset: Required<Inset> = { ...NO_INSET };
  private insetTween: Tween<Required<Inset>> | null = null;
  private size = { width: 1, height: 1 };
  private view: CameraView = CAMERA_VIEWS["three-quarter"];
  private pose: Pose;
  private flight: Tween<Pose> | null = null;
  /** True once a finger, zoom, drift or sway has moved the camera away from the view. Reframing then leaves it in place. */
  private adjusted = false;
  private fitMode: CameraFit = "box";
  private keepFittedDistance = false;
  /** The distance fitted for the first view while keepDistance is on. */
  private keptDistance: number | null = null;

  private followed: Followed | null = null;
  private followStiffness = 3;

  private swayOptions: SwayOptions | null = null;
  private readonly swing = new Swing();

  private orbit: OrbitOptions | null = null;
  private gesture: Gesture | null = null;
  /** Turn speed after a flick, in degrees per second. */
  private flick = still();
  private releasedAt: number | null = null;

  constructor(camera: THREE.PerspectiveCamera, options: CameraRigOptions = {}) {
    this.camera = camera;
    this.baseNear = camera.near;
    this.baseFar = camera.far;
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.pose = this.poseOf(this.view);
  }

  /**
   * Swings the camera slowly back and forth around the view's azimuth, or
   * null for no sway. The swing pauses while a finger turns the camera or
   * it flies, then blends back in from where the camera was left. Orbit
   * limits are unaffected.
   */
  get sway(): SwayOptions | null {
    return this.swayOptions;
  }
  set sway(sway: SwayOptions | null) {
    if (sameSway(sway, this.swayOptions)) return;
    this.swayOptions = sway ? { ...sway } : null;
    this.swing.restart();
  }

  /** What is fitted in frame (see CameraFit). Setting it reframes the current view. */
  get fit() {
    return this.fitMode;
  }
  set fit(fit: CameraFit) {
    this.fitMode = fit;
    this.keptDistance = null;
    this.reframe();
  }

  /**
   * Keeps the distance fitted for the first view for later views without
   * their own distance, so turning to another side does not zoom. The
   * distance is fitted again when the subject or the viewport changes.
   */
  get keepDistance() {
    return this.keepFittedDistance;
  }
  set keepDistance(keep: boolean) {
    this.keepFittedDistance = keep;
    this.keptDistance = null;
    this.reframe();
  }

  /** The point the camera looks at. */
  get target(): THREE.Vector3 {
    return this.pose.target;
  }

  /** True while flying between views or easing to new insets. */
  get moving() {
    return this.flight !== null || this.insetTween !== null;
  }

  /** True while a finger is down. */
  get touching() {
    return this.gesture !== null;
  }

  /** Milliseconds until the camera flies back to the view, or null if it will not. */
  get returnsIn() {
    const after = this.orbit?.returnAfter;
    if (after === undefined || this.releasedAt === null || this.gesture) return null;
    return Math.max(0, this.releasedAt + after * 1000 - this.now());
  }

  /** Returns the named view (built in or from `views`), or `view` itself if it is not a name. */
  resolve(view: string | CameraView): CameraView {
    return typeof view === "string" ? findView(view, this.options.views) : view;
  }

  /**
   * Sets the box to keep in frame, in world space, or null. Without
   * `transition`, the current view is reframed and a camera moved by hand
   * stays where it is. With `transition`, the subject is treated as new: the
   * camera returns to the view, flying there over `transition` seconds, or
   * jumping at once when it is 0.
   */
  setSubject(box: THREE.Box3 | null, { transition }: { transition?: number } = {}) {
    const hadSubject = this.subject !== null;
    this.subject = box && !box.isEmpty() ? box.clone() : null;
    this.keptDistance = null;
    if (transition === undefined) this.reframe();
    else if (transition > 0 && hadSubject) this.flyTo(this.view, transition);
    else this.jumpTo(this.view);
  }

  /**
   * Sets the canvas size and the edges covered by UI, then reframes the
   * current view. With `transition` (seconds) and an unchanged size, the
   * insets ease to their new values instead, for example as a sheet slides
   * away. A camera moved by hand stays where it is.
   */
  setViewport(
    width: number,
    height: number,
    inset: Inset = {},
    { transition = 0 }: { transition?: number } = {},
  ) {
    const size = { width: Math.max(1, width), height: Math.max(1, height) };
    const to = { ...NO_INSET, ...inset };
    const sameSize = size.width === this.size.width && size.height === this.size.height;
    this.size = size;
    if (transition > 0 && sameSize) {
      this.insetTween = { from: { ...this.inset }, to, elapsed: 0, duration: transition };
      return;
    }
    this.insetTween = null;
    this.inset = to;
    this.keptDistance = null;
    this.reframe();
  }

  /** Puts the camera at `view` at once. */
  jumpTo(view: string | CameraView) {
    this.view = this.resolve(view);
    this.flight = null;
    this.flick = still();
    this.adjusted = false;
    if (this.followed) this.followed.aim.copy(this.aimPointOf(this.followed));
    this.pose = this.poseOf(this.view);
    this.apply();
  }

  /** Flies to `view` over `seconds` (default 0.9), on an arc around the target. */
  flyTo(view: string | CameraView, seconds = 0.9) {
    this.view = this.resolve(view);
    const to = this.poseOf(this.view);
    if (seconds <= 0) {
      this.jumpTo(this.view);
      return;
    }
    const from = { ...this.pose, target: this.pose.target.clone() };
    to.azimuth = shortestTurn(from.azimuth, to.azimuth);
    this.flight = { from, to, elapsed: 0, duration: seconds };
    this.flick = still();
    this.adjusted = false;
  }

  /**
   * Follows a moving object, such as a train or a runner. The orbit centre
   * eases towards it at `stiffness` per second (higher is tighter), and the
   * framing keeps the subject's size. Pass null to stop following.
   */
  follow(object: THREE.Object3D | null, stiffness = 3) {
    this.followStiffness = stiffness;
    if (!object) {
      this.followed = null;
      return;
    }
    object.updateWorldMatrix(true, false);
    const origin = object.getWorldPosition(new THREE.Vector3());
    // Aim at the subject's centre rather than the object's origin, which is often at its base.
    const centre = this.subject?.getCenter(new THREE.Vector3()) ?? origin.clone();
    // The aim starts at the current target and eases onto the object.
    this.followed = { object, offset: centre.sub(origin), aim: this.pose.target.clone(), last: null };
    this.track(0);
    this.reframe();
  }

  /** Enables touch control of the camera (see `touch`), or disables it with null. */
  setOrbit(options: OrbitOptions | null) {
    this.orbit = options;
    if (!options) {
      this.gesture = null;
      this.flick = still();
      this.releasedAt = null;
    }
  }

  /**
   * Reports the fingers on the canvas at `time` in milliseconds. Call it on
   * every touch start and move. One finger turns the camera and two pinch
   * to zoom. Returns true if the camera moved.
   */
  touch(points: readonly TouchPoint[], time: number) {
    const orbit = this.orbit;
    if (!orbit || points.length === 0) return false;
    const previous = this.gesture;
    if (!previous) {
      // A new touch stops any flight or flick.
      this.flight = null;
      this.flick = still();
      this.releasedAt = null;
    }
    const current = points.slice(0, 2).map((p) => ({ x: p.x, y: p.y }));
    if (!previous || previous.points.length !== current.length) {
      // Restart when the finger count changes, so lifting one finger of a pinch does not jump.
      this.gesture = {
        points: current,
        time,
        moved: previous?.moved ?? 0,
        limits: previous?.limits ?? this.limits(orbit),
      };
      return false;
    }
    const gesture = previous;
    const moved =
      current.length === 1 ? this.drag(gesture, current, time, orbit) : this.pinch(gesture, current, orbit);
    gesture.points = current;
    gesture.time = time;
    if (moved) this.apply();
    return moved;
  }

  /** Reports that all fingers lifted at `time` in milliseconds. Returns how far they moved in points, so a tap is near 0. */
  release(time: number) {
    const gesture = this.gesture;
    if (!gesture) return 0;
    this.gesture = null;
    if (time - gesture.time > FLICK_HOLD_MS || this.orbit?.inertia === false) this.flick = still();
    this.releasedAt = this.now();
    return gesture.moved;
  }

  /** Zooms by `factor` (above 1 moves away) within the orbit's zoom limits, as for a mouse wheel. */
  zoom(factor: number) {
    const orbit = this.orbit;
    if (!orbit || orbit.zoom === false) return false;
    const moved = this.zoomBy(factor, this.limits(orbit));
    if (moved) {
      this.flight = null;
      this.releasedAt = this.now();
      this.apply();
    }
    return moved;
  }

  /** Advances by `delta` seconds. Returns true while the camera is still moving. */
  update(delta: number) {
    const following = this.track(delta);
    const drifting = this.drift !== 0 && !this.flight && !this.gesture;
    if (drifting) {
      this.pose.azimuth += this.drift * delta;
      this.adjusted = true;
    }
    const coasting = this.coast(delta);
    const swaying = this.stepSway(delta, coasting);
    if (this.returnsIn === 0 && this.orbit) {
      this.releasedAt = null;
      this.flyTo(this.view);
    }
    const easing = this.stepInset(delta);
    const flying = this.fly(delta);
    if (following || drifting || coasting || swaying) this.apply();
    return flying || easing || following || drifting || coasting || swaying;
  }

  // One-finger drag. Dragging right turns the subject right (the camera goes left); dragging down raises the camera.
  private drag(gesture: Gesture, current: TouchPoint[], time: number, orbit: OrbitOptions) {
    const seconds = Math.max(1, time - gesture.time) / 1000;
    const degreesPerPoint = (180 / this.size.width) * (orbit.speed ?? 1);
    const dx = current[0].x - gesture.points[0].x;
    const dy = current[0].y - gesture.points[0].y;
    gesture.moved += Math.hypot(dx, dy);
    const azimuth = -dx * degreesPerPoint;
    const elevation = dy * degreesPerPoint;
    const moved = this.turn(azimuth, elevation, gesture.limits);
    // Smooth the flick speed over recent moves.
    const smooth = (old: number, latest: number) => old * 0.3 + latest * 0.7;
    this.flick = {
      azimuth: smooth(this.flick.azimuth, azimuth / seconds),
      elevation: smooth(this.flick.elevation, elevation / seconds),
    };
    return moved;
  }

  private pinch(gesture: Gesture, current: TouchPoint[], orbit: OrbitOptions) {
    if (orbit.zoom === false) return false;
    const before = pinchSpan(gesture.points);
    const after = pinchSpan(current);
    gesture.moved += Math.abs(after - before);
    const moved = before > 0 && after > 0 && this.zoomBy(before / after, gesture.limits);
    this.flick = still();
    return moved;
  }

  private limits(orbit: OrbitOptions) {
    return orbitLimits(orbit, this.pose.azimuth, this.poseOf(this.view));
  }

  // Turns by (azimuth, elevation) degrees within `limits`. Returns true if the camera moved.
  private turn(azimuth: number, elevation: number, limits: Pick<OrbitLimits, "azimuth" | "elevation">) {
    const { azimuth: a, elevation: e } = this.pose;
    this.pose.azimuth = within(a, a + azimuth, limits.azimuth);
    this.pose.elevation = within(e, e + elevation, limits.elevation);
    const moved = this.pose.azimuth !== a || this.pose.elevation !== e;
    if (moved) this.adjusted = true;
    return moved;
  }

  private zoomBy(factor: number, limits: Pick<OrbitLimits, "distance">) {
    const d = this.pose.distance;
    this.pose.distance = within(d, d * factor, limits.distance);
    if (this.pose.distance !== d) this.adjusted = true;
    return this.pose.distance !== d;
  }

  private aimPointOf(followed: Followed) {
    followed.object.updateWorldMatrix(true, false);
    return followed.object.getWorldPosition(new THREE.Vector3()).add(followed.offset);
  }

  // Moves the orbit centre and the subject box after the followed object. Returns true while catching up.
  private track(delta: number) {
    const f = this.followed;
    if (!f) return false;
    const goal = this.aimPointOf(f);
    f.aim.lerp(goal, 1 - Math.exp(-this.followStiffness * Math.max(0, delta)));
    if (this.subject) {
      // On the first step the box is centred on the object; after that it moves with it.
      const from = f.last ?? this.subject.getCenter(new THREE.Vector3());
      this.subject.translate(goal.clone().sub(from));
    }
    f.last = goal;
    this.pose.target.copy(f.aim);
    return f.aim.distanceToSquared(goal) > 1e-6;
  }

  // Returns true while a sway is set, including while it is paused.
  private stepSway(delta: number, coasting: boolean) {
    const sway = this.swayOptions;
    if (!sway) return false;
    if (this.gesture || this.flight || coasting) {
      this.swing.restart();
      return true;
    }
    const centre = shortestTurn(this.pose.azimuth, this.poseOf(this.view).azimuth);
    this.pose.azimuth = this.swing.step(this.pose.azimuth, centre, delta, sway);
    this.adjusted = true;
    return true;
  }

  // Keeps turning after a flick, slowing down. Returns true while turning.
  private coast(delta: number) {
    const { azimuth, elevation } = this.flick;
    if (this.gesture || !this.orbit || (azimuth === 0 && elevation === 0)) return false;
    // A zero-length step, such as the first after the loop wakes, moves nothing but still counts as turning.
    if (delta <= 0) return true;
    const moved = this.turn(azimuth * delta, elevation * delta, this.limits(this.orbit));
    const decay = Math.exp(-FLICK_DECAY * delta);
    this.flick = { azimuth: azimuth * decay, elevation: elevation * decay };
    if (!moved || Math.hypot(this.flick.azimuth, this.flick.elevation) < FLICK_STOP_SPEED) {
      this.flick = still();
      // The returnAfter wait starts when the camera comes to rest.
      if (this.releasedAt !== null) this.releasedAt = this.now();
    }
    return moved;
  }

  // Returns true while the inset tween continues.
  private stepInset(delta: number) {
    const tween = this.insetTween;
    if (!tween) return false;
    tween.elapsed = Math.min(tween.duration, tween.elapsed + delta);
    this.inset = lerpInset(tween.from, tween.to, easeInOut(tween.elapsed / tween.duration));
    if (tween.elapsed >= tween.duration) this.insetTween = null;
    this.keptDistance = null;
    this.reframe();
    return this.insetTween !== null;
  }

  // Returns true while the flight continues.
  private fly(delta: number) {
    const f = this.flight;
    if (!f) return false;
    f.elapsed = Math.min(f.duration, f.elapsed + delta);
    const t = easeInOut(f.elapsed / f.duration);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    this.pose = {
      azimuth: lerp(f.from.azimuth, f.to.azimuth),
      elevation: lerp(f.from.elevation, f.to.elevation),
      // Interpolate distance geometrically so the speed feels even both close up and far away.
      distance: f.from.distance * (f.to.distance / f.from.distance) ** t,
      // Head for the followed object's current position, which may have moved since the flight began.
      target: f.from.target.clone().lerp(this.followed ? this.aimPointOf(this.followed) : f.to.target, t),
      fov: lerp(f.from.fov, f.to.fov),
    };
    if (f.elapsed >= f.duration) {
      this.flight = null;
      if (this.followed) this.followed.aim.copy(this.pose.target);
    }
    this.apply();
    return this.flight !== null;
  }

  // Recomputes the current view's pose after the subject, viewport or fit changed.
  private reframe() {
    const to = this.poseOf(this.view);
    if (this.flight) {
      to.azimuth = shortestTurn(this.flight.from.azimuth, to.azimuth);
      this.flight.to = to;
    } else {
      if (!this.adjusted) this.pose = to;
      this.apply();
    }
  }

  private poseOf(view: CameraView): Pose {
    // `pose` is still unset when the constructor calls this.
    const current = (this.pose as Pose | undefined)?.target;
    const target = view.target
      ? new THREE.Vector3(...view.target)
      : (this.followed?.aim?.clone() ??
        this.fittedBox()?.getCenter(new THREE.Vector3()) ??
        current?.clone() ??
        new THREE.Vector3());
    const fov = view.fov ?? this.camera.fov;
    let { azimuth = 0, elevation = 0 } = view;
    let distance = view.distance;
    if (view.position) {
      const offset = new THREE.Vector3(...view.position).sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      azimuth = spherical.theta / DEG;
      elevation = 90 - spherical.phi / DEG;
      distance = spherical.radius;
    }
    elevation = clampElevation(elevation);
    if (distance === undefined) {
      const keep = this.keepFittedDistance;
      distance =
        keep && this.keptDistance !== null ? this.keptDistance : this.fitted(azimuth, elevation, target, fov);
      if (keep && this.keptDistance === null && this.subject) this.keptDistance = distance;
    }
    return { azimuth, elevation, distance, target, fov };
  }

  private fittedBox(): THREE.Box3 | null {
    return this.subject ? boxToFit(this.subject, this.fitMode) : null;
  }

  // The distance at which the fitted box fills the free part of the screen.
  private fitted(azimuth: number, elevation: number, target: THREE.Vector3, fov: number) {
    const box = this.fittedBox();
    if (!box) return DEFAULT_DISTANCE;
    const distance = fitBoxDistance(box, {
      azimuth,
      elevation,
      target,
      fov,
      width: this.size.width,
      height: this.size.height,
      inset: this.inset,
      margin: this.options.margin ?? 0.1,
    });
    return Math.max(distance, this.camera.near * 2);
  }

  private apply() {
    const { azimuth, elevation, distance, target, fov } = this.pose;
    const { back } = cameraBasis(azimuth, elevation);
    this.camera.position.copy(target).addScaledVector(back, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.fov = fov;
    // Widen the clipping range for far views so the subject and what lies beyond it stay visible.
    this.camera.far = Math.max(this.baseFar, distance * 5);
    this.camera.near = Math.max(this.baseNear, Math.min(distance * 0.002, 1));
    // Shift the projection so the target sits in the centre of the free part of the screen.
    const { width, height } = this.size;
    const { top, bottom, left, right } = this.inset;
    if (top || bottom || left || right) {
      this.camera.setViewOffset(width, height, (right - left) / 2, (bottom - top) / 2, width, height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
