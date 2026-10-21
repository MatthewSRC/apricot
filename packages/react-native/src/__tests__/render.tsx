import type { ApricotScene } from "@apricotjs/core";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Scene, type SceneProps } from "../Scene";
import { frames } from "./setup";

/** Renders <Scene> and waits until it is attached; returns the ApricotScene. */
export const renderScene = async (children?: ReactNode, props: Partial<SceneProps> = {}) => {
  let scene: ApricotScene | null = null;
  const tree = (content: ReactNode) => (
    <Scene
      // Sleep right after the last change, so tests can check when the loop sleeps.
      linger={0}
      {...props}
      onCreated={(s) => {
        scene = s;
        props.onCreated?.(s);
      }}
    >
      {content}
    </Scene>
  );
  const view = render(tree(children));
  await act(async () => {
    await Promise.resolve();
  });
  if (!scene) throw new Error("scene did not start");
  /** Re-renders new children inside the same <Scene>. */
  const update = (content: ReactNode) => view.rerender(tree(content));
  return { ...view, update, scene: scene as ApricotScene };
};

/** Steps `n` animation frames inside act(). */
export const stepFrames = async (n = 1, ms = 16) => {
  await act(async () => {
    for (let i = 0; i < n; i++) frames.step(ms);
  });
};

/**
 * Calls the onLayout handler of the first view in `container` (jsdom never
 * lays anything out, so React Native Web never fires it).
 */
export const fireLayout = async (container: HTMLElement, width: number, height: number) => {
  const node = container.firstElementChild as Element & Record<string, unknown>;
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$")) as string;
  let fiber = node[key] as { memoizedProps?: { onLayout?: (e: unknown) => void }; return: unknown } | null;
  while (fiber && !fiber.memoizedProps?.onLayout) fiber = fiber.return as typeof fiber;
  if (!fiber) throw new Error("no onLayout handler found");
  const onLayout = fiber.memoizedProps?.onLayout as (e: unknown) => void;
  await act(async () => {
    onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });
};

/** The `name` handler (onTouchStart, onClick…) of the first view in `container`. */
export const viewHandler = (container: HTMLElement, name: string) => {
  const node = container.firstElementChild as Element & Record<string, unknown>;
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$")) as string;
  let fiber = node[key] as { memoizedProps?: Record<string, unknown>; return: unknown } | null;
  while (fiber && typeof fiber.memoizedProps?.[name] !== "function") fiber = fiber.return as typeof fiber;
  if (!fiber) throw new Error(`no ${name} handler found`);
  return fiber.memoizedProps?.[name] as (event: unknown) => void;
};

type Handler = (event: unknown) => unknown;

/**
 * Responder events on the scene's view: fingers at `points` (in page
 * points) at `timestamp`. With `origin`, the scene's top-left sits there on
 * the page (as a view below a header would).
 */
export const fingers = (container: HTMLElement, origin = { x: 0, y: 0 }) => {
  const handler = (name: string) => viewHandler(container, name) as Handler;
  const event = (points: [number, number][], timestamp: number) => ({
    nativeEvent: {
      touches: points.map(([pageX, pageY]) => ({ pageX, pageY })),
      timestamp,
      ...(points[0]
        ? {
            pageX: points[0][0],
            pageY: points[0][1],
            locationX: points[0][0] - origin.x,
            locationY: points[0][1] - origin.y,
          }
        : {}),
    },
  });
  return {
    wants: () => handler("onStartShouldSetResponder")({}) === true,
    grant: (points: [number, number][], t: number) => handler("onResponderGrant")(event(points, t)),
    down: (points: [number, number][], t: number) =>
      act(async () => void handler("onResponderGrant")(event(points, t))),
    add: (points: [number, number][], t: number) =>
      act(async () => void handler("onResponderStart")(event(points, t))),
    move: (points: [number, number][], t: number) =>
      act(async () => void handler("onResponderMove")(event(points, t))),
    lift: (points: [number, number][], t: number) =>
      act(async () => void handler("onResponderEnd")(event(points, t))),
    up: (t: number) => act(async () => void handler("onResponderRelease")(event([], t))),
    cancel: (t: number) => act(async () => void handler("onResponderTerminate")(event([], t))),
    keeps: () => handler("onResponderTerminationRequest")({}) === false,
  };
};
