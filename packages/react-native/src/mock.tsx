// Entry point @apricotjs/react-native/mock. It replaces @apricotjs/react-native, /model and
// /capture in tests of screens with a <Scene>, without three.js or a GPU.
// <Scene> renders a View with testID "apricot-scene". The 3D components draw
// nothing but render their children, so text in a <Label> and your own
// components inside the scene are still rendered. Hooks return values that
// do nothing. useLayout and fileStorage are the real implementations.
//
//   jest.mock("@apricotjs/react-native", () => require("@apricotjs/react-native/mock"));
//   jest.mock("@apricotjs/react-native/model", () => require("@apricotjs/react-native/mock"));
//   jest.mock("@apricotjs/react-native/capture", () => require("@apricotjs/react-native/mock"));

import { createContext, type ReactNode, type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

export { fileStorage, useLayout } from "./useLayout";

/** A value that does nothing: every property access, call and `new` returns it again. */
// biome-ignore lint/suspicious/noExplicitAny: stands in for any value
const inert: any = new Proxy(class Inert {}, {
  get: (target, key) => {
    if (key === Symbol.toPrimitive) return () => 0;
    if (key === Symbol.iterator) return function* () {};
    if (key === "then") return undefined;
    // Proxy invariants require the target's own prototype here.
    if (key === "prototype") return target.prototype;
    return inert;
  },
  apply: () => inert,
  construct: () => inert,
});

interface StubProps {
  children?: ReactNode;
  ref?: Ref<unknown>;
  // Any other props of the real component.
  [prop: string]: unknown;
}

/** A component that renders only its children. A ref receives a handle that does nothing. */
const stub = (name: string) => {
  const Stub = ({ children, ref }: StubProps) => {
    useImperativeHandle(ref, () => inert, []);
    return <>{children}</>;
  };
  Stub.displayName = name;
  return Stub;
};

const noop = (..._: unknown[]) => {};

/** How the mock <Scene> behaves. See mockScene. */
export interface MockSceneOptions {
  /** Whether the scene starts, calling onCreated and then onReady after mount. Default false: it never starts. */
  ready?: boolean;
  /** An error passed to onError after mount, as on a device without WebGPU. */
  error?: Error;
}

let sceneMock: MockSceneOptions = {};

/**
 * Sets how every mock <Scene> behaves from now on, for flows that wait on it.
 * `mockScene({ ready: true })` calls onCreated (with a scene that does
 * nothing) and onReady after mount, `mockScene({ error })` calls onError, and
 * `mockScene()` restores the default of never starting.
 *
 *   beforeEach(() => mockScene({ ready: true }));
 */
export const mockScene = (options: MockSceneOptions = {}) => {
  sceneMock = options;
};

type SceneCallbacks = {
  onCreated?: (scene: unknown) => void;
  onReady?: (scene: unknown) => void;
  onError?: (error: Error) => void;
  loading?: ReactNode;
};

export const Scene = ({
  children,
  style,
  onCreated,
  onReady,
  onError,
}: StubProps & SceneCallbacks & { style?: StyleProp<ViewStyle> }) => {
  const callbacks = useRef({ onCreated, onReady, onError });
  callbacks.current = { onCreated, onReady, onError };
  useEffect(() => {
    const { error, ready } = sceneMock;
    if (error) callbacks.current.onError?.(error);
    else if (ready) {
      callbacks.current.onCreated?.(inert);
      callbacks.current.onReady?.(inert);
    }
  }, []);
  return (
    <View testID="apricot-scene" style={style}>
      {children}
    </View>
  );
};

export const Blur = stub("Blur");
export const Bundle = stub("Bundle");
export const CameraRig = stub("CameraRig");
export const Daylight = stub("Daylight");
export const DebugHud = stub("DebugHud");
export const Environment = stub("Environment");
export const FitCamera = stub("FitCamera");
export const FollowCamera = stub("FollowCamera");
export const FollowPath = stub("FollowPath");
export const Group = stub("Group");
export const Instances = stub("Instances");
export const Label = stub("Label");
export const Lamp = stub("Lamp");
export const LightBeam = stub("LightBeam");
export const Merged = stub("Merged");
export const Model = stub("Model");
export const Particles = stub("Particles");
export const Pile = stub("Pile");
export const Placeable = stub("Placeable");
export const Placement = stub("Placement");
export const Primitive = stub("Primitive");
export const Spin = stub("Spin");
export const Terrain = stub("Terrain");
export const Vehicle = stub("Vehicle");
export const Water = stub("Water");
export const WindowPane = stub("WindowPane");
export const AmbientLight = stub("AmbientLight");
export const DirectionalLight = stub("DirectionalLight");
export const HemisphereLight = stub("HemisphereLight");
export const PointLight = stub("PointLight");
export const SpotLight = stub("SpotLight");
export const Box = stub("Box");
export const Capsule = stub("Capsule");
export const Cone = stub("Cone");
export const Cylinder = stub("Cylinder");
export const Mesh = stub("Mesh");
export const Plane = stub("Plane");
export const Slab = stub("Slab");
export const Sphere = stub("Sphere");
export const Torus = stub("Torus");

export const useScene = () => inert;
export const useFrame = noop;
export const useAttach = noop;
export const useParent = () => inert;
export const useSceneTouches = noop;
export const useTransform = noop;
export const useAnimatable =
  <T,>(value: T) =>
  () =>
    value;
export const useDaylight = () => () => null;
export const useMaterial = () => inert;
export const useMaterialInput = () => inert;
export const useMaterialOverrides = noop;
export const usePath = () => inert;
export const useTrip = () => inert;
export const useTripStatus = () => inert;
export const useShore = () => inert;
export const useBounds = () => null;
export const NO_BOUNDS = "apricotNoBounds";
export const leaveOutOfFootprint = noop;
// Apps under test take the path they take on a phone with WebGPU.
export const gpuSupport = async () => "webgpu" as const;
export const useWaves = () => inert;
export const useModel = () => ({ object: null, animations: [], error: null });
export const useTexture = () => null;
export const useTextureState = () => ({ texture: null, error: null });

export const ParentContext = createContext<unknown>(null);
export const BURSTS = inert;
export const EMITTERS = inert;
export const CAMERA_VIEWS = inert;
export const DAY = inert;
export const MOONLIT = inert;
export const Path = inert;
export const Trip = inert;
export const PresetMaterial = inert;
export const modelCache = inert;
export const textureCache = inert;
export const createMaterial = () => inert;
export const defineEnvironment = noop;
export const definePreset = noop;
export const defineBehavior = ({ name }: { name: string }) => stub(name);
export const defineModelKit = (src: unknown, parts: unknown) => ({ src, parts });
export const smoothOutline = <T,>(outline: T) => outline;
export const applyTransform = noop;
export const diagnosticsJson = () => "{}";
export const shareDiagnostics = async () => {};
export const loadModelBytes = async () => new ArrayBuffer(0);
export const captureScene = async () => ({ uri: "file:///apricot/capture.png", width: 1, height: 1 });
export const captureUri = () => null;
export const deleteCapture = () => false;
export const clearCaptures = () => 0;
export const download = async () => {};
export const isDownloaded = () => true;
export const forgetDownloads = noop;
export const measureModel = async () => ({ minX: -0.5, maxX: 0.5, minY: 0, maxY: 1, minZ: -0.5, maxZ: 0.5 });
