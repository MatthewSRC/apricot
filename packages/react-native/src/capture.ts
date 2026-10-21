// Entry point @apricotjs/react-native/capture. It is separate from @apricotjs/react-native so
// that apps which never capture a picture do not bundle the PNG encoder.

import type { ApricotScene, Pixels } from "@apricotjs/core";
import { shrinkPixels } from "@apricotjs/core";
import { encodePng } from "@apricotjs/core/png";
import { Platform } from "react-native";
import { needs, optional } from "./optional";

export interface CaptureOptions {
  /**
   * Maximum size in pixels: `[width, height]`, or one number for both (such
   * as 256 for a thumbnail). The picture is scaled down to fit, never up.
   * Default: the size as drawn, which is the view's size times its pixel ratio.
   */
  maxSize?: number | readonly [number, number];
  /** File name without ".png" (default `capture-<time>`). Saving again under the same name replaces the file. */
  name?: string;
  /**
   * Where the file is kept on a phone: "cache" (default), which the system
   * may clear when space runs low, or "documents", kept until the app deletes
   * it or is uninstalled. Either way it is in an `apricot` folder (see
   * captureUri).
   */
  directory?: CaptureDirectory;
}

/** Where captureScene keeps pictures. See CaptureOptions.directory. */
export type CaptureDirectory = "cache" | "documents";

/** A captured picture: its URI (a file, or a blob URL on the web) and its size in pixels. */
export interface Capture {
  uri: string;
  width: number;
  height: number;
}

/**
 * Captures the scene's next frame as a PNG, as shown on screen, for example
 * for a share card or a gallery thumbnail. On a phone it is saved to a file
 * in an `apricot` folder in the app's cache, which needs expo-file-system. On
 * the web it is a blob URL. It waits until the scene is ready. Models that
 * are still loading are not included, so capture after their onLoad.
 *
 *   <Scene onCreated={setScene}>…</Scene>
 *   const { uri } = await captureScene(scene, { maxSize: 1080 });
 *   await Sharing.shareAsync(uri);
 */
export async function captureScene(scene: ApricotScene, options: CaptureOptions = {}): Promise<Capture> {
  const { maxSize, name = `capture-${Date.now()}`, directory = "cache" } = options;
  if (Platform.OS !== "web" && !optional.fileSystem) throw needs("expo-file-system", "captureScene");
  let pixels = await scene.capture();
  if (maxSize !== undefined) {
    const [w, h] = typeof maxSize === "number" ? [maxSize, maxSize] : maxSize;
    pixels = shrinkPixels(pixels, w, h);
  }
  const { width, height } = pixels;
  if (Platform.OS === "web") return { uri: await webPicture(pixels), width, height };
  const { File } = optional.fileSystem as NonNullable<typeof optional.fileSystem>;
  const folder = folderOf(directory);
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${name}.png`);
  if (!file.exists) file.create();
  file.write(encodePng(pixels));
  return { uri: file.uri, width, height };
}

const folderOf = (directory: CaptureDirectory) => {
  const { Directory, Paths } = optional.fileSystem as NonNullable<typeof optional.fileSystem>;
  return new Directory(directory === "documents" ? Paths.document : Paths.cache, "apricot");
};

/**
 * Returns the current URI of the picture captureScene saved as `name`, or
 * null if there is none. Always null on the web, where pictures are blob URLs
 * that last as long as the page. Store the name rather than the URI: on iOS
 * the app's folders can move between launches, so a stored URI goes stale.
 *
 *   await captureScene(scene, { name: `room-${id}`, maxSize: 256 });
 *   <Image source={{ uri: captureUri(`room-${id}`) ?? undefined }} />
 */
export function captureUri(name: string, { directory = "cache" }: { directory?: CaptureDirectory } = {}) {
  if (Platform.OS === "web" || !optional.fileSystem) return null;
  const { File } = optional.fileSystem;
  const file = new File(folderOf(directory), `${name}.png`);
  return file.exists ? file.uri : null;
}

/**
 * Deletes the picture captureScene saved as `name` from the cache, or from
 * `directory`. Returns whether it existed. Does nothing on the web.
 */
export function deleteCapture(name: string, { directory = "cache" }: { directory?: CaptureDirectory } = {}) {
  if (Platform.OS === "web" || !optional.fileSystem) return false;
  const { File } = optional.fileSystem;
  const file = new File(folderOf(directory), `${name}.png`);
  if (!file.exists) return false;
  file.delete();
  return true;
}

/**
 * Deletes every picture captureScene saved in the cache, or in `directory`,
 * for example when the user signs out. Returns how many were deleted.
 */
export function clearCaptures({ directory = "cache" }: { directory?: CaptureDirectory } = {}) {
  if (Platform.OS === "web" || !optional.fileSystem) return 0;
  const folder = folderOf(directory);
  if (!folder.exists) return 0;
  let count = 0;
  for (const entry of folder.list()) {
    if (!entry.name.endsWith(".png")) continue;
    entry.delete();
    count++;
  }
  return count;
}

/** Encodes `pixels` as a PNG blob URL using the browser. */
const webPicture = (pixels: Pixels) =>
  new Promise<string>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("[apricot] captureScene: no 2D canvas to make the picture"));
    const image = context.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    canvas.toBlob(
      (blob) =>
        blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("[apricot] captureScene: no picture")),
      "image/png",
    );
  });
