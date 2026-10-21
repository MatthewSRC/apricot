/** Model file extensions that Metro bundles as assets. */
export declare const ASSET_EXTENSIONS: string[];
/**
 * Adds Apricot support to a Metro config: bundles .glb and .gltf files as assets and
 * resolves "three" and "three/webgpu" to the WebGPU build of three.js.
 */
export declare function withApricot<T extends { projectRoot: string; resolver: object }>(config: T): T;
