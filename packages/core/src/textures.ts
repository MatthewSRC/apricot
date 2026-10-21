import * as THREE from "three/webgpu";

const isReactNative = () => typeof navigator !== "undefined" && navigator.product === "ReactNative";

/**
 * Decodes PNG or JPEG bytes into an ImageBitmap. On React Native,
 * react-native-webgpu's createImageBitmap decodes encoded bytes natively
 * (Hermes has no image decoder, and React Native's Blob cannot hold binary
 * data); browsers decode a Blob.
 */
export const decodeImage = async (
  bytes: ArrayBuffer | ArrayBufferView,
  mimeType = "image/png",
): Promise<ImageBitmap> => {
  if (typeof createImageBitmap === "undefined")
    throw new Error("createImageBitmap is not available to decode images");
  if (isReactNative()) return createImageBitmap(bytes as never);
  return createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
};

export interface TextureOptions {
  /** SRGBColorSpace for colour images (default), NoColorSpace for data such as masks or normal maps. */
  colorSpace?: THREE.ColorSpace;
  /** Image rows top to bottom map to v = 1 … 0, as three expects (default true). */
  flipY?: boolean;
  /** Repeats the image instead of clamping at the edges. */
  repeat?: boolean;
  /**
   * Keeps colours premultiplied by alpha (default true). Image decoders on
   * iOS and Android premultiply, and converting back to straight colour on
   * upload gives faint edge pixels wrong colours, since alpha 1/255 cannot
   * hold a colour. Preset materials divide alpha out after filtering. Pass
   * false for your own three.js materials that expect straight colour.
   */
  premultiplyAlpha?: boolean;
}

/** A texture from encoded image bytes (PNG, JPEG). */
export const textureFromBytes = async (
  bytes: ArrayBuffer | ArrayBufferView,
  {
    colorSpace = THREE.SRGBColorSpace,
    flipY = true,
    repeat = false,
    premultiplyAlpha = true,
  }: TextureOptions = {},
) => {
  const image = await decodeImage(bytes);
  const texture = new THREE.Texture(image as unknown as HTMLImageElement);
  texture.colorSpace = colorSpace;
  texture.flipY = flipY;
  texture.premultiplyAlpha = premultiplyAlpha;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};
