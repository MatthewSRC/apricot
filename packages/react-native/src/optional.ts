import type { ComponentType } from "react";

// Optional peer packages. Each is loaded with a `require` inside try/catch,
// which Expo's Metro config allows to fail (allowOptionalDependencies), and is
// null when missing. Their types are declared here rather than imported, so
// apps without them still type-check.

/** The part of a Reanimated shared or derived value that Apricot reads. */
export interface SharedLike<T> {
  readonly value: T;
}

/** What Apricot uses of react-native-reanimated. */
export interface ReanimatedModule {
  default: { View: ComponentType<object> };
  isSharedValue: (value: unknown) => boolean;
  useSharedValue: <T>(initial: T) => { value: T };
  useAnimatedStyle: (style: () => object) => object;
  useAnimatedReaction: <T>(
    prepare: () => T,
    react: (next: T, previous: T | null) => void,
    deps?: readonly unknown[],
  ) => void;
}

/** What Apricot uses of react-native-worklets. */
export interface WorkletsModule {
  createSynchronizable: <T>(initial: T) => { getDirty: () => T; setBlocking: (value: T) => void };
  scheduleOnRN: (fn: () => void) => void;
}

/** What Apricot uses of expo-file-system. */
export interface FileSystemModule {
  File: new (
    ...parts: unknown[]
  ) => {
    uri: string;
    exists: boolean;
    create: () => void;
    write: (content: string | Uint8Array) => void;
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    delete: () => void;
  };
  Directory: new (
    ...parts: unknown[]
  ) => {
    exists: boolean;
    create: (options?: { intermediates?: boolean; idempotent?: boolean }) => void;
    delete: () => void;
    list: () => { name: string; delete: () => void }[];
  };
  Paths: { document: unknown; cache: unknown };
}

/** What Apricot uses of expo-asset. */
export interface AssetModule {
  Asset: {
    fromModule: (module: number | string) => {
      name: string;
      uri: string;
      localUri: string | null;
      downloaded: boolean;
      downloadAsync: () => Promise<unknown>;
    };
  };
}

/** Returns `get()`, or null if it throws, as a require of a missing package does. */
export const load = <T>(get: () => unknown): T | null => {
  try {
    return get() as T;
  } catch {
    return null;
  }
};

// Metro allows a package to be missing only when its require is directly inside its own try block.
let reanimated: ReanimatedModule | null = null;
let worklets: WorkletsModule | null = null;
let fileSystem: FileSystemModule | null = null;
let asset: AssetModule | null = null;
try {
  reanimated = require("react-native-reanimated");
} catch {}
try {
  worklets = require("react-native-worklets");
} catch {}
try {
  fileSystem = require("expo-file-system");
} catch {}
try {
  asset = require("expo-asset");
} catch {}

/** The optional packages, each null if not installed. Read at each use, so tests can replace them. */
export const optional = { reanimated, worklets, fileSystem, asset };

/** The error for a feature used without the packages it needs. Its message says what to install. */
export const needs = (packages: string, feature: string) =>
  new Error(`[apricot] ${feature} needs ${packages}: npx expo install ${packages}`);
