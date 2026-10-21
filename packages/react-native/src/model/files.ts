import { Platform } from "react-native";
import { needs, optional } from "../optional";

/** A bundled asset (`require("./car.glb")`) or a URL. */
export type ModelSource = number | string;

/** A 16-digit hex hash of `text`, from two FNV-1a hashes. Used as the file name for a URL. */
const hashOf = (text: string) => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
};

/** The folder in the app's cache that downloads are kept in, or null on the web and without expo-file-system. */
const downloads = () => {
  const files = optional.fileSystem;
  return Platform.OS === "web" || !files
    ? null
    : new files.Directory(files.Paths.cache, "apricot", "downloads");
};

/** The file a download of `url` is kept in, or null where downloads are not kept. */
const keptFile = (url: string) => {
  const folder = downloads();
  if (!folder || !optional.fileSystem) return null;
  // Taken from the string, since React Native's URL has no `pathname`.
  const extension = /\.[a-z0-9]{1,5}$/i.exec(url.split(/[?#]/)[0])?.[0] ?? "";
  return { folder, file: new optional.fileSystem.File(folder, `${hashOf(url)}${extension.toLowerCase()}`) };
};

/** Fetches the bytes at `url` and keeps a copy on the device. Failing to write the copy is not an error. */
const fetchAndKeep = async (url: string) => {
  const response = await fetch(url);
  if (response.ok === false) throw new Error(`[apricot] ${url}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const kept = keptFile(url);
  if (kept)
    try {
      if (!kept.folder.exists) kept.folder.create({ intermediates: true, idempotent: true });
      if (!kept.file.exists) kept.file.create();
      kept.file.write(new Uint8Array(bytes));
    } catch {
      // Not kept, for example on a full disk. It is fetched again next time.
    }
  return bytes;
};

/**
 * Reads the bytes of a model or image. Bundled assets are resolved with
 * expo-asset and read from disk, which also works in release builds. A URL
 * is downloaded once and kept in the app's cache (with expo-file-system),
 * then read from there, so it also loads offline.
 */
export const loadModelBytes = async (src: ModelSource): Promise<ArrayBuffer> => {
  if (typeof src === "string") {
    const kept = keptFile(src);
    if (kept?.file.exists) return kept.file.arrayBuffer();
    return fetchAndKeep(src);
  }
  // Bundled files need expo-asset, and expo-file-system to read them on a device. A URL needs neither.
  if (!optional.asset) throw needs("expo-asset expo-file-system", "Loading a bundled model");
  const asset = optional.asset.Asset.fromModule(src);
  await asset.downloadAsync();
  if (Platform.OS === "web") return (await fetch(asset.uri)).arrayBuffer();
  if (asset.localUri && !asset.localUri.includes(":")) {
    // Android release builds keep bundled images as drawable resources, and
    // expo-asset reports the bare resource name as already downloaded.
    // Downloading again makes expo-asset copy the resource into a real file.
    asset.downloaded = false;
    asset.localUri = null;
    await asset.downloadAsync();
  }
  if (!asset.localUri) throw new Error(`Asset has no local file: ${asset.name}`);
  if (!optional.fileSystem) throw needs("expo-file-system", "Loading a bundled model");
  return new optional.fileSystem.File(asset.localUri).arrayBuffer();
};

/** Whether the file at `url` has been downloaded to the device, so it loads offline. */
export const isDownloaded = (url: string) => keptFile(url)?.file.exists ?? false;

/**
 * Downloads files such as models and images to the device so they load
 * offline. Skips files already downloaded, fetches three at a time, and
 * calls `onProgress` with how many are done. Rejects if any download fails;
 * the ones that finished are kept. Needs expo-file-system. On the web it
 * fetches nothing, since the browser's cache keeps files.
 */
export const download = async (
  urls: readonly string[],
  { onProgress }: { onProgress?: (done: number, total: number) => void } = {},
) => {
  if (Platform.OS === "web") return;
  if (!optional.fileSystem) throw needs("expo-file-system", "download");
  const missing = urls.filter((url) => !isDownloaded(url));
  let done = urls.length - missing.length;
  onProgress?.(done, urls.length);
  const next = async (): Promise<void> => {
    const url = missing.shift();
    if (url === undefined) return;
    await fetchAndKeep(url);
    if (!isDownloaded(url)) throw new Error(`[apricot] download: ${url} could not be kept`);
    onProgress?.(++done, urls.length);
    return next();
  };
  await Promise.all([next(), next(), next()]);
};

/**
 * Deletes downloaded files from the device: those of `urls`, or all of them.
 * They are downloaded again when next used.
 */
export const forgetDownloads = (urls?: readonly string[]) => {
  if (!urls) {
    const folder = downloads();
    if (folder?.exists) folder.delete();
    return;
  }
  for (const url of urls) {
    const kept = keptFile(url);
    if (kept?.file.exists) kept.file.delete();
  }
};
