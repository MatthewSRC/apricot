import { abs, float, fwidth, length, max, min, select, smoothstep, uniform, uv, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";

export interface MarkerShape {
  /** Width and depth of the patch, in metres. */
  size?: readonly [number, number];
  /** Fill colour (default blue). */
  color?: THREE.ColorRepresentation;
  /** Opacity from 0 to 1 (default 0.8). */
  opacity?: number;
  /** Corner radius in metres (default 0.06). Half the shorter side or more gives a pill or a disc. */
  radius?: number;
  /** When above 0, draws only a ring of this thickness in metres along the edge (default 0, filled). */
  outline?: number;
}

/** A marker patch with functions to read and update its shape. */
export interface Marker {
  /** A 1 × 1 plane in x and y with the marker's material. `set` scales it to `size`. */
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
  /** Updates the shape and colour. These are uniforms, so no shader is rebuilt. */
  set: (shape: MarkerShape) => void;
  /** The current shape and colour. */
  get: () => Required<MarkerShape> & { color: string };
  /** Disposes the geometry and material. */
  dispose: () => void;
}

/**
 * A flat patch that marks a place, such as the spot under a piece of
 * furniture being moved. It draws a soft-edged rounded rectangle, pill or
 * disc, or a ring around one, on a plane. The corner radius stays in
 * metres when the patch is resized.
 */
export const createMarker = ({
  size = [1, 1],
  color = "#4f8cff",
  opacity = 0.8,
  radius = 0.06,
  outline = 0,
}: MarkerShape = {}): Marker => {
  const extent = uniform(new THREE.Vector2(...size));
  const corner = uniform(radius);
  const ring = uniform(outline);
  const tint = uniform(new THREE.Color(color));
  const alpha = uniform(opacity);
  // Signed distance in metres from the rounded rectangle's edge, negative inside.
  const half = extent.mul(0.5);
  const r = min(corner, min(half.x, half.y));
  const q = abs(uv().sub(0.5).mul(extent)).sub(half).add(r);
  const d = length(max(q, vec2(0)))
    .add(min(max(q.x, q.y), float(0)))
    .sub(r);
  const soft = max(fwidth(d), float(1e-4));
  const inside = float(1).sub(smoothstep(soft.negate(), soft, d));
  const band = select(
    ring.greaterThan(0),
    smoothstep(ring.negate().sub(soft), ring.negate().add(soft), d),
    float(1),
  );
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = tint;
  material.opacityNode = inside.mul(band).mul(alpha);
  material.fog = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = "Marker";
  mesh.scale.set(size[0], size[1], 1);
  const set = (shape: MarkerShape) => {
    if (shape.size) {
      extent.value.set(shape.size[0], shape.size[1]);
      mesh.scale.set(shape.size[0], shape.size[1], 1);
    }
    if (shape.color !== undefined) tint.value.set(shape.color);
    if (shape.opacity !== undefined) alpha.value = shape.opacity;
    if (shape.radius !== undefined) corner.value = shape.radius;
    if (shape.outline !== undefined) ring.value = shape.outline;
  };
  return {
    mesh,
    set,
    get: () => ({
      size: [extent.value.x, extent.value.y],
      color: `#${tint.value.getHexString()}`,
      opacity: alpha.value,
      radius: corner.value,
      outline: ring.value,
    }),
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
};
