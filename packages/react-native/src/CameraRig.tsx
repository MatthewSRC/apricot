import {
  type CameraFit,
  type CameraView,
  type Inset,
  type OrbitOptions,
  CameraRig as Rig,
  type SwayOptions,
} from "@apricotjs/core";
import {
  type Ref,
  type RefObject,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three/webgpu";
import { seenBounds, watchInside } from "./bounds";
import { useScene } from "./context";
import { useFrame } from "./hooks";
import { ParentContext, type SceneObject } from "./parent";
import { useSceneTouches } from "./touches";

/** Moves the camera from code. See <CameraRig ref>. */
export interface CameraRigHandle {
  /** Flies to a view, given by name or described, over `seconds`. Default: the rig's `transition`. */
  flyTo(view: string | CameraView, seconds?: number): void;
  /** Moves the camera to a view at once. */
  jumpTo(view: string | CameraView): void;
}

export interface CameraRigProps {
  /**
   * The view to show: "front", "back", "left", "right", "top",
   * "three-quarter" (default), a name from `views`, or a view object
   * `{ azimuth, elevation, distance, target, position, fov }`. Changing it
   * flies the camera to the new view.
   */
  view?: string | CameraView;
  /** Additional named views. */
  views?: Record<string, CameraView>;
  /**
   * Seconds a change of view takes, and a change of what is framed, such as
   * a new <Model src> or a new `subject`. 0 cuts to it. Default 0.9.
   */
  transition?: number;
  /** Space covered by UI such as a bottom sheet or a header, in points. The subject is framed in the rest. */
  inset?: Inset;
  /** Extra room around the subject, as a fraction of its size. Default 0.1. */
  margin?: number;
  /**
   * What to frame. Default: the parent, so a rig inside a <Model> or <Group>
   * frames it. With null nothing is framed, and views need a `distance`.
   */
  subject?: THREE.Object3D | null;
  /**
   * A moving object to follow, such as a train or a runner. The orbit's
   * centre eases after it, and its size is framed unless `subject` is given.
   */
  follow?: RefObject<SceneObject | null> | SceneObject | null;
  /** How tightly `follow` is followed, per second. Higher is tighter. Default 3. */
  followStiffness?: number;
  /** Degrees per second at which the camera slowly circles the subject. Default 0. */
  drift?: number;
  /**
   * Swings the camera slowly back and forth around the view instead of
   * circling: `{ degrees, period }`, by default 12° either way over 12 s. It
   * pauses while a finger turns the camera and resumes from where it was
   * left. Orbit limits stay relative to the view.
   */
  sway?: SwayOptions | boolean;
  /**
   * What is fitted in frame:
   *
   * - "box" (default): the subject's box.
   * - "footprint": the subject's floor plan, so a room with tall walls frames
   *   at the same scale as a flat island of the same size.
   * - `{ footprint: object }`: the floor plan of that object, such as the
   *   floor or tile the subject stands on, so palm fronds reaching past an
   *   island's edge do not make it frame smaller.
   * - `[width, height, depth]`: a box in metres where the subject stands, to
   *   frame every subject at one scale.
   *
   * As with `subject`, pass the object itself (for example from a ref
   * callback, kept in state), not a ref.
   */
  fit?: CameraFitProp;
  /** Keeps the distance fitted for the first view for later views, so changing the view does not zoom. */
  keepDistance?: boolean;
  /**
   * Lets the user turn the camera around the subject with a finger and zoom
   * by pinching, or with the mouse wheel on the web. Pass true, or limits
   * `{ turn, elevation, zoom, speed, inertia, returnAfter }`. Taps on objects
   * still work.
   *
   *   <CameraRig orbit={{ elevation: [5, 60], zoom: [0.6, 1.5], returnAfter: 4 }} />
   */
  orbit?: boolean | OrbitOptions;
  /**
   * Called when a finger goes down on the scene to turn the camera.
   * onOrbitEnd is called when all fingers have lifted. On Android, scroll
   * views and pagers around the scene do not take the drag. iOS cannot block
   * them from JavaScript, so disable a ScrollView's scrolling, or a screen's
   * swipe back, in these callbacks:
   *
   *   <CameraRig orbit onOrbitStart={() => setScrolls(false)} onOrbitEnd={() => setScrolls(true)} />
   *   <ScrollView scrollEnabled={scrolls}>
   */
  onOrbitStart?: () => void;
  /**
   * Called when the fingers start turning or zooming the camera, by moving
   * further than a tap or by pinching. Unlike onOrbitStart, it is not called
   * for a tap, so it tells turning the scene apart from tapping something in
   * it.
   */
  onTurnStart?: () => void;
  /** Called when all fingers have lifted after onOrbitStart, with how far they moved in points. */
  onOrbitEnd?: (gesture: { moved: number }) => void;
  ref?: Ref<CameraRigHandle>;
}

/** What CameraRig fits in frame. See CameraRigProps.fit. */
export type CameraFitProp =
  | Exclude<CameraFit, { readonly footprint: THREE.Box3 }>
  | { readonly footprint: SceneObject | null };

const floorOf = (fit: CameraFitProp) =>
  typeof fit === "string" || !("footprint" in fit) ? null : fit.footprint;
const fitKeyOf = (fit: CameraFitProp) => {
  if (typeof fit === "string") return fit;
  if ("footprint" in fit) return `footprint:${floorOf(fit)?.uuid ?? ""}`;
  return fit.join();
};

// How far the fingers move, in points, before a gesture counts as turning instead of a tap.
const TURN_AFTER = 10;

/**
 * Moves the camera between named views on arcs around the subject, keeping
 * it framed at any screen size and clear of your UI.
 *
 *   <Model kit={civic}>
 *     <CameraRig view={showTop ? "top" : "three-quarter"} inset={{ bottom: 280 }} />
 *   </Model>
 */
export function CameraRig({
  view = "three-quarter",
  views,
  transition = 0.9,
  inset,
  margin,
  subject,
  follow,
  followStiffness = 3,
  drift = 0,
  sway = false,
  fit = "box",
  keepDistance = false,
  orbit = false,
  onOrbitStart,
  onTurnStart,
  onOrbitEnd,
  ref,
}: CameraRigProps) {
  const scene = useScene();
  const parent = useContext(ParentContext);
  const options = useRef({ views, margin });
  options.current.views = views;
  options.current.margin = margin;
  const [rig] = useState(() => new Rig(scene.camera, options.current));
  const fitKey = fitKeyOf(fit);
  const latestTransition = useRef(transition);
  latestTransition.current = transition;
  useImperativeHandle(
    ref,
    () => ({
      flyTo: (next, seconds = transition) => {
        scene.diagnostics.note("camera", { flyTo: next, seconds });
        rig.flyTo(next, seconds);
        scene.invalidate();
      },
      jumpTo: (next) => {
        rig.jumpTo(next);
        scene.invalidate();
      },
    }),
    [rig, scene, transition],
  );

  rig.drift = drift;
  rig.sway = sway === true ? {} : sway || null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fitKey` stands for `fit`
  useEffect(() => {
    const floor = floorOf(fit);
    if (typeof fit === "string" || !("footprint" in fit)) {
      rig.fit = fit;
      scene.invalidate();
      return;
    }
    // Measured at once, and again when objects are added to the floor or removed from it.
    const measure = () => {
      rig.fit = { footprint: floor ? seenBounds(floor, scene.camera) : new THREE.Box3() };
      scene.invalidate();
    };
    measure();
    return floor ? watchInside(floor, measure) : undefined;
  }, [rig, scene, fitKey]);
  useEffect(() => {
    rig.keepDistance = keepDistance;
    scene.invalidate();
  }, [rig, scene, keepDistance]);
  // Requests a frame so swaying starts even when the scene is idle.
  const swayKey = JSON.stringify(sway);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `swayKey` stands for `sway`
  useEffect(() => {
    if (sway) scene.invalidate();
  }, [scene, swayKey]);
  // The subject is measured once, at rest, so moving parts such as opening doors do not change the framing.
  const followed = follow && "current" in follow ? follow : null;
  const fallback = parent === scene.scene ? null : parent;
  const framed = subject === undefined ? (follow ? null : fallback) : subject;
  // A new subject is flown to over `transition`; the first one is framed at once.
  const measuredBefore = useRef<THREE.Object3D | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a ref's object is read when the effect runs
  useEffect(() => {
    const target = followed ? followed.current : ((follow as THREE.Object3D | null | undefined) ?? null);
    const measured = framed ?? target;
    if (measured) {
      measured.updateWorldMatrix(true, true);
      const before = measuredBefore.current;
      measuredBefore.current = measured;
      rig.setSubject(
        seenBounds(measured, scene.camera),
        before && before !== measured ? { transition: latestTransition.current } : {},
      );
    } else {
      rig.setSubject(null);
    }
    rig.follow(target, followStiffness);
    scene.diagnostics.note("camera", { follow: target?.name || (target ? "object" : null) });
    scene.invalidate();
    return () => rig.follow(null);
  }, [rig, framed, follow, followStiffness, scene]);

  const { top = 0, bottom = 0, left = 0, right = 0 } = inset ?? {};
  // A changed inset eases over `transition`. The first inset and size changes apply at once.
  const framedOnce = useRef(false);
  useEffect(() => {
    const edges = { top, bottom, left, right };
    rig.setViewport(scene.size.width, scene.size.height, edges, {
      transition: framedOnce.current ? latestTransition.current : 0,
    });
    framedOnce.current = true;
    scene.invalidate();
    return scene.onResize(() => {
      rig.setViewport(scene.size.width, scene.size.height, edges);
      scene.invalidate();
    });
  }, [rig, scene, top, bottom, left, right]);

  // The first view is shown at once. Later ones are flown to.
  const key = typeof view === "string" ? view : JSON.stringify(view);
  const shown = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `view`
  useEffect(() => {
    if (shown.current === null) rig.jumpTo(view);
    else rig.flyTo(view, transition);
    scene.diagnostics.note("camera", { view, transition: shown.current === null ? 0 : transition });
    shown.current = key;
    scene.invalidate();
  }, [rig, key, scene]);

  // Clears the camera's view offset when the rig unmounts.
  useEffect(
    () => () => {
      scene.camera.clearViewOffset();
      scene.camera.updateProjectionMatrix();
    },
    [scene],
  );

  const orbitOptions = orbit === true ? {} : orbit || null;
  const orbitKey = JSON.stringify(orbitOptions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `orbitKey` stands for `orbitOptions`
  useEffect(() => {
    rig.setOrbit(orbitOptions);
    return () => rig.setOrbit(null);
  }, [rig, orbitKey]);
  const holding = useRef(false);
  // Where the first finger went down, and whether the gesture has started turning the camera.
  const started = useRef<{ x: number; y: number; turning: boolean } | null>(null);
  useSceneTouches(
    {
      touch: (points, time) => {
        if (!holding.current) {
          holding.current = true;
          started.current = points[0] ? { x: points[0].x, y: points[0].y, turning: false } : null;
          onOrbitStart?.();
        }
        const start = started.current;
        if (start && !start.turning) {
          const [first] = points;
          if (points.length > 1 || (first && Math.hypot(first.x - start.x, first.y - start.y) > TURN_AFTER)) {
            start.turning = true;
            onTurnStart?.();
          }
        }
        if (rig.touch(points, time)) scene.invalidate();
      },
      release: (time) => {
        const moved = rig.release(time);
        scene.invalidate();
        if (holding.current) {
          holding.current = false;
          started.current = null;
          onOrbitEnd?.({ moved });
        }
        return moved;
      },
      wheel: (deltaY) => {
        if (rig.zoom(Math.exp(deltaY * 0.002))) scene.invalidate();
      },
    },
    orbitOptions !== null,
  );

  // A timer requests a frame when `returnAfter` is due, since the scene renders no frames while idle.
  const wake = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wake.current) clearTimeout(wake.current);
    },
    [],
  );
  // The camera's target, used to centre shadows. Cleared when the rig unmounts.
  useEffect(
    () => () => {
      scene.focus = null;
    },
    [scene],
  );
  useFrame(({ delta }) => {
    const moving = rig.update(delta);
    scene.focus = rig.target;
    const wait = rig.returnsIn;
    if (wait !== null && !moving) {
      if (wake.current) clearTimeout(wake.current);
      wake.current = setTimeout(() => {
        wake.current = null;
        scene.invalidate();
      }, wait + 16);
    }
    return moving;
  });
  return null;
}
