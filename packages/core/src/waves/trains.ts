import { cos, dot, sin, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

export interface WaveOptions {
  /** Wave amplitude from the middle to a crest, in metres (default 0.06). 0 gives still water. */
  height?: number;
  /** Wavelength from crest to crest, in metres (default 2.5). */
  length?: number;
  /** Speed of travel in metres per second (default 0.8). */
  speed?: number;
  /** Direction of travel in degrees around the vertical axis (default 0, towards +x). */
  direction?: number;
}

// A main swell plus two smaller trains at angles to it, which breaks up the regular ridges of a single sine.
const TRAINS = [
  { amplitude: 1, length: 1, turn: 0, phase: 0 },
  { amplitude: 0.45, length: 0.62, turn: 38, phase: 1.7 },
  { amplitude: 0.28, length: 0.37, turn: -57, phase: 4.1 },
];

interface Train {
  amplitude: number;
  k: number;
  omega: number;
  dx: number;
  dz: number;
  phase: number;
}

/**
 * Waves on water, as a sum of a few sine trains. The same waves drive the
 * water surface (see createWaterMaterial) and objects floating on it (see
 * heightAt and slopeAt), so floating objects ride the drawn crests. Advance
 * them with `tick`.
 */
export class Waves {
  /** Seconds since the waves started. A shader uniform, so changing it does not recompile anything. */
  readonly time = uniform(0);
  /** The highest the waves can reach, in metres. A shader uniform. */
  readonly peak = uniform(1);
  private trains: Train[] = [];
  private options: Required<WaveOptions> = { height: 0.06, length: 2.5, speed: 0.8, direction: 0 };
  // Per train: (k * dx, k * dz, omega, phase) and amplitude.
  private readonly uniforms = TRAINS.map(() => ({
    wave: uniform(new THREE.Vector4()),
    amplitude: uniform(0),
  }));

  constructor(options: WaveOptions = {}) {
    this.set(options);
  }

  /**
   * Updates the wave settings. Options that are omitted or undefined keep
   * their current values. The trains are uniforms, so no shader is rebuilt.
   */
  set(options: WaveOptions) {
    const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    this.options = { ...this.options, ...given };
    const { height, length, speed, direction } = this.options;
    this.trains = TRAINS.map((t) => {
      const a = THREE.MathUtils.degToRad(direction + t.turn);
      const k = (2 * Math.PI) / Math.max(1e-3, length * t.length);
      return {
        amplitude: height * t.amplitude,
        k,
        omega: k * speed,
        dx: Math.cos(a),
        dz: Math.sin(a),
        phase: t.phase,
      };
    });
    this.peak.value = Math.max(
      1e-6,
      this.trains.reduce((sum, t) => sum + t.amplitude, 0),
    );
    this.trains.forEach((t, i) => {
      const u = this.uniforms[i];
      u.wave.value.set(t.dx * t.k, t.dz * t.k, t.omega, t.phase);
      u.amplitude.value = t.amplitude;
    });
  }

  /** The current settings. */
  get settings(): Readonly<Required<WaveOptions>> {
    return this.options;
  }

  /** Sets the wave time to `seconds`. */
  tick(seconds: number) {
    this.time.value = seconds;
  }

  /** The water's current height above its rest level at ground point (x, z). */
  heightAt(x: number, z: number) {
    const t = this.time.value;
    let h = 0;
    for (const w of this.trains)
      h += w.amplitude * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
    return h;
  }

  /** The water's current slope at (x, z) along x and along z, for tilting floating objects. */
  slopeAt(x: number, z: number): [number, number] {
    const t = this.time.value;
    let sx = 0;
    let sz = 0;
    for (const w of this.trains) {
      const c = w.amplitude * w.k * Math.cos(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
      sx += c * w.dx;
      sz += c * w.dz;
    }
    return [sx, sz];
  }

  /** Shader nodes for the height and the x and z slopes at world point `xz`. */
  nodes(xz: THREE.Node<"vec3">) {
    const terms = this.uniforms.map(({ wave, amplitude }) => {
      const arg = dot(xz.xz, wave.xy).sub(wave.z.mul(this.time)).add(wave.w);
      const slope = amplitude.mul(cos(arg));
      return { height: amplitude.mul(sin(arg)), sx: slope.mul(wave.x), sz: slope.mul(wave.y) };
    });
    const [a, b, c] = terms;
    return {
      height: a.height.add(b.height).add(c.height),
      sx: a.sx.add(b.sx).add(c.sx),
      sz: a.sz.add(b.sz).add(c.sz),
    };
  }
}
