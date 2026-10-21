// A separate entry point (@apricotjs/core/models), because three's GLTFLoader
// adds about 100 KB of bytecode that apps without models should not carry.
import "./polyfills";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as THREE from "three/webgpu";
import { SharedCache } from "./cache";
import { disposeObject } from "./dispose";
import { decodeImage } from "./textures";

export interface LoadedModel {
  /** The model's root. Do not add it to a scene: add instance(model) instead. */
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

// glTF sampler constants (WebGL enums) to three's.
const FILTERS: Record<number, THREE.TextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};
const WRAPS: Record<number, THREE.Wrapping> = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};

interface GLTFParserLike {
  json: {
    textures: { source?: number; sampler?: number; name?: string }[];
    images: { bufferView?: number; uri?: string; mimeType?: string; name?: string }[];
    samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  };
  associations: Map<unknown, unknown>;
  getDependency(type: "bufferView", index: number): Promise<ArrayBuffer>;
}

/**
 * Decodes textures embedded in a .glb straight from their bytes. three's
 * default path wraps them in a Blob and an object URL, which React Native's
 * Blob does not support, so textured models would load without textures.
 * Images stored as external files fall back to three's loader.
 */
export class ImageBytesPlugin {
  readonly name = "APRICOT_image_bytes";

  constructor(private readonly parser: GLTFParserLike) {}

  loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
    const { json } = this.parser;
    const textureDef = json.textures[textureIndex];
    const imageDef = textureDef.source === undefined ? undefined : json.images[textureDef.source];
    if (!imageDef) return null;
    let bytes: Promise<ArrayBuffer | Uint8Array>;
    if (imageDef.bufferView !== undefined)
      bytes = this.parser.getDependency("bufferView", imageDef.bufferView);
    else if (imageDef.uri?.startsWith("data:")) bytes = Promise.resolve(dataUriBytes(imageDef.uri));
    else return null;
    return bytes.then(async (data) => {
      const texture = new THREE.Texture(
        (await decodeImage(data, imageDef.mimeType)) as unknown as HTMLImageElement,
      );
      // glTF UVs start at the top of the image.
      texture.flipY = false;
      texture.name = textureDef.name ?? imageDef.name ?? "";
      const sampler =
        (textureDef.sampler !== undefined ? json.samplers?.[textureDef.sampler] : undefined) ?? {};
      texture.magFilter = FILTERS[sampler.magFilter ?? 9729] as THREE.MagnificationTextureFilter;
      texture.minFilter = FILTERS[sampler.minFilter ?? 9987] as THREE.MinificationTextureFilter;
      texture.wrapS = WRAPS[sampler.wrapS ?? 10497];
      texture.wrapT = WRAPS[sampler.wrapT ?? 10497];
      texture.generateMipmaps =
        texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
      texture.needsUpdate = true;
      this.parser.associations.set(texture, { textures: textureIndex });
      return texture;
    });
  }
}

const dataUriBytes = (uri: string) => {
  const base64 = uri.slice(uri.indexOf(",") + 1);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/**
 * Parses a binary glTF (.glb) from bytes. It takes bytes rather than a URL
 * because fetching bundled assets by URL fails in React Native release
 * builds. Draco, meshopt and KTX2 are not supported, since Hermes has no
 * WebAssembly. Use KHR_mesh_quantization and PNG or JPEG textures instead
 * (`apricot-models` in @apricotjs/metro converts models this way).
 */
export const parseModel = async (bytes: ArrayBuffer): Promise<LoadedModel> => {
  const loader = new GLTFLoader().register(
    (parser) => new ImageBytesPlugin(parser as unknown as GLTFParserLike),
  );
  const gltf = await loader.parseAsync(bytes, "");
  return { scene: gltf.scene as unknown as THREE.Group, animations: gltf.animations };
};

const hasSkin = (root: THREE.Object3D) => {
  let found = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
};

/**
 * A copy of the model to add to a scene. Copies share geometry, materials and
 * textures, so ten cars cost one load. Rigged models (characters) get their
 * own skeleton per copy, so each can move on its own.
 */
export const instance = (model: LoadedModel): THREE.Group =>
  hasSkin(model.scene) ? (cloneSkinned(model.scene) as THREE.Group) : model.scene.clone(true);

/**
 * Loads each model once and shares it. acquire() and release() count users;
 * the last release disposes the model's GPU resources.
 */
export class ModelCache extends SharedCache<LoadedModel> {
  constructor(load: (key: string) => Promise<LoadedModel>) {
    super(load, (model) => disposeObject(model.scene));
  }
}
