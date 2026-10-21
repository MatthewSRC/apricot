import {
  abs,
  clamp,
  cos,
  exp,
  float,
  instancedBufferAttribute,
  max as larger,
  length,
  mix,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { BurstOptions, EmitOptions, Emitter, Spread } from "./particles/options";
import { seededRandom } from "./random";
import { compileWhileHidden } from "./scene";

export type { BurstOptions, EmitOptions, Emitter, Spread } from "./particles/options";
export { BURSTS, EMITTERS } from "./particles/presets";

const pick = (value: Spread, random: () => number) =>
  typeof value === "number" ? value : value[0] + (value[1] - value[0]) * random();

type Stream = { options: EmitOptions; last: number; owed: number; running: boolean };

/**
 * GPU particles for sparks, fireworks, confetti, smoke and snow. Bursts and
 * streams write each particle's starting state once, and the shader computes
 * its position from the time, so live particles cost no CPU time between
 * bursts. With `glow`, particles blend additively, which suits dark scenes;
 * otherwise they blend normally, which shows on light ones. A `texture`
 * gives each particle an image tinted by its colour. Advance them with
 * `update`. When more than `max` particles are needed, the oldest are reused.
 */
export class Particles {
  readonly object: THREE.Sprite;
  /** The time last passed to update, in seconds. A shader uniform. */
  private readonly now = uniform(0);
  // Per particle, one vec4 each: start [x, y, z, birth], velocity [vx, vy, vz, life], look [r, g, b, size],
  // motion [ax, ay, az, drag], end [r, g, b, grow] and turn [angle, spin, square, unused].
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly velocity: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly motion: THREE.InstancedBufferAttribute;
  private readonly end: THREE.InstancedBufferAttribute;
  private readonly turn: THREE.InstancedBufferAttribute;
  private next = 0;
  /** When the last live particle dies, in seconds. */
  private until = Number.NEGATIVE_INFINITY;
  private readonly random: () => number;
  /** True from a burst or stream until its last particle is gone. The sprite is visible meanwhile. */
  private bursting = false;
  private readonly streams = new Set<Stream>();
  private readonly color = new THREE.Color();
  private readonly fade = new THREE.Color();

  constructor(
    readonly max = 1000,
    {
      glow = false,
      seed = 1,
      texture: picture,
    }: { glow?: boolean; seed?: number; texture?: THREE.Texture | null } = {},
  ) {
    this.random = seededRandom(seed);
    const attribute = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.start = attribute();
    this.velocity = attribute();
    this.look = attribute();
    this.motion = attribute();
    this.end = attribute();
    this.turn = attribute();
    // A birth time far in the past means every particle starts dead.
    for (let i = 0; i < max; i++) this.start.setW(i, -1e6);

    const node = (a: THREE.InstancedBufferAttribute) => instancedBufferAttribute<"vec4">(a, "vec4");
    const start = node(this.start);
    const velocity = node(this.velocity);
    const look = node(this.look);
    const motion = node(this.motion);
    const end = node(this.end);
    const turn = node(this.turn);
    const age = this.now.sub(start.w);
    const life = velocity.w;
    // `alive` is 1 between birth and the end of life; `through` is the fraction of life elapsed.
    const alive = step(0, age).mul(step(age, life));
    const through = clamp(age.div(larger(life, 1e-3)), 0, 1);
    const drag = larger(motion.w, 1e-3);
    // Displacement from velocity under drag, v(1 - e^(-kt)) / k, plus constant acceleration, at²/2.
    const flown = velocity.xyz.mul(
      float(1)
        .sub(exp(drag.negate().mul(age)))
        .div(drag),
    );
    const pushed = motion.xyz.mul(age.mul(age).mul(0.5));
    const material = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.positionNode = start.xyz.add(flown).add(pushed);
    const fade = float(1).sub(smoothstep(0.55, 1, through));
    const size = look.w
      .mul(mix(float(1), end.w, through))
      .mul(alive)
      .mul(fade.mul(0.5).add(0.5));
    const angle = turn.x.add(turn.y.mul(age));
    // Squares get narrower as they turn edge on, which looks like fluttering paper.
    const square = turn.z;
    const flutter = mix(
      float(1),
      abs(cos(angle.mul(0.7)))
        .mul(0.8)
        .add(0.2),
      square,
    );
    material.scaleNode = vec2(size.mul(flutter), size);
    material.rotationNode = angle;
    const tint = mix(look.xyz, end.xyz, through);
    // The tinted texture if given, otherwise a soft round dot or a soft-edged square.
    const sampled = picture ? texture(picture, uv()) : null;
    const centred = uv().sub(0.5);
    const dot = float(1).sub(smoothstep(0.2, 0.5, length(centred)));
    const box = float(1).sub(smoothstep(0.4, 0.5, larger(abs(centred.x), abs(centred.y))));
    material.colorNode = sampled ? tint.mul(sampled.rgb) : tint;
    material.opacityNode = (sampled ? sampled.a : mix(dot, box, square)).mul(fade).mul(alive);
    this.object = new THREE.Sprite(material);
    this.object.name = "Particles";
    this.object.count = max;
    // Hidden while no particle is alive, but compiled with the scene so the first burst does not stall.
    this.object.visible = false;
    compileWhileHidden(this.object);
    // Positions are computed on the GPU, so the CPU cannot cull them.
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
  }

  /** Whether any particle is alive at `seconds` or a stream is running. Keep rendering frames while this is true. */
  aliveAt(seconds: number) {
    return this.streams.size > 0 || seconds < this.until;
  }

  /**
   * Sets the time to `seconds` and emits the particles streams owe since the
   * last update. Any clock works as long as bursts use the same one. Returns
   * whether any particle is alive.
   */
  update(seconds: number) {
    this.now.value = seconds;
    for (const stream of this.streams) {
      const { options, last } = stream;
      const owed = stream.owed + Math.max(0, seconds - last) * Math.max(0, options.rate ?? 20);
      const count = Math.min(Math.floor(owed), this.max);
      stream.owed = owed - Math.floor(owed);
      stream.last = seconds;
      // Spread births over the time since the last update so the stream stays even.
      if (count > 0) this.send(options, count, last, seconds);
    }
    const alive = this.aliveAt(seconds);
    // Hide the sprite once the last particle is gone so it costs nothing to render. It is only hidden here,
    // after a burst, so that it stays visible while the scene warm-up compiles it.
    if (!alive && this.bursting) {
      this.bursting = false;
      this.object.visible = false;
    }
    return alive;
  }

  /** Emits a burst of particles at time `seconds`, on the same clock as update. */
  burst(options: BurstOptions, seconds: number) {
    this.send(options, options.count ?? 40, seconds, seconds);
  }

  /**
   * Starts a stream of `rate` particles per second at time `seconds`, on the
   * same clock as update, which emits them. Returns an Emitter for changing
   * or stopping the stream.
   */
  emit(options: EmitOptions, seconds: number): Emitter {
    const stream: Stream = { options: { ...options }, last: seconds, owed: 0, running: true };
    this.streams.add(stream);
    this.object.visible = true;
    this.bursting = true;
    return {
      set: (changes) => {
        stream.options = { ...stream.options, ...changes };
      },
      stop: () => {
        stream.running = false;
        this.streams.delete(stream);
      },
      get running() {
        return stream.running;
      },
    };
  }

  /** Stops every stream. */
  stopAll() {
    for (const stream of this.streams) stream.running = false;
    this.streams.clear();
  }

  // Writes `count` particles with birth times spread evenly from `from` to `to`, in seconds.
  private send(options: BurstOptions, count: number, from: number, to: number) {
    const {
      at = [0, 0, 0],
      area,
      colors = ["#ffffff"],
      fadeTo,
      speed = [1, 2],
      direction = [0, 1, 0],
      spread = 180,
      life = [0.6, 1.2],
      size = 0.05,
      grow = 1,
      spin = 0,
      shape = "dot",
      gravity = 0,
      wind = [0, 0, 0],
      drag = 0,
    } = options;
    const random = this.random;
    const axis = new THREE.Vector3(...direction).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const way = new THREE.Vector3();
    const cosSpread = Math.cos(THREE.MathUtils.degToRad(Math.min(180, Math.max(0, spread))));
    const square = shape === "square" ? 1 : 0;
    const turns = square === 1 || spin !== 0;
    if (fadeTo !== undefined) this.fade.set(fadeTo);
    const n = Math.min(count, this.max);
    const first = this.next;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      // A direction uniformly distributed over the spherical cap within `spread` of the axis.
      const y = 1 - random() * (1 - cosSpread);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = random() * Math.PI * 2;
      way
        .set(r * Math.cos(a), y, r * Math.sin(a))
        .applyQuaternion(turn)
        .multiplyScalar(pick(speed, random));
      const lives = pick(life, random);
      const born = n > 1 && to > from ? from + ((to - from) * (k + 1)) / n : to;
      this.color.set(colors[Math.floor(random() * colors.length)] ?? "#ffffff");
      const end = fadeTo === undefined ? this.color : this.fade;
      const x = area ? at[0] + (random() - 0.5) * area[0] : at[0];
      const yy = area ? at[1] + (random() - 0.5) * area[1] : at[1];
      const z = area ? at[2] + (random() - 0.5) * area[2] : at[2];
      this.start.setXYZW(i, x, yy, z, born);
      this.velocity.setXYZW(i, way.x, way.y, way.z, lives);
      this.look.setXYZW(i, this.color.r, this.color.g, this.color.b, pick(size, random));
      this.motion.setXYZW(i, wind[0], wind[1] - gravity, wind[2], drag);
      this.end.setXYZW(i, end.r, end.g, end.b, grow);
      const angle = turns ? random() * Math.PI * 2 : 0;
      this.turn.setXYZW(i, angle, THREE.MathUtils.degToRad(pick(spin, random)), square, 0);
      this.until = Math.max(this.until, born + lives);
    }
    this.object.visible = true;
    this.bursting = true;
    this.changed(first, n);
  }

  // Marks only the `n` particles written from `first` for upload, wrapping around the end.
  private changed(first: number, n: number) {
    if (n === 0) return;
    const ranges =
      first + n <= this.max
        ? [[first, n]]
        : [
            [first, this.max - first],
            [0, first + n - this.max],
          ];
    for (const attribute of [this.start, this.velocity, this.look, this.motion, this.end, this.turn]) {
      for (const [from, count] of ranges) attribute.addUpdateRange(from * 4, count * 4);
      attribute.needsUpdate = true;
    }
  }

  /** Stops all streams and disposes the material. */
  dispose() {
    this.stopAll();
    // The sprite geometry is shared by all three.js sprites, so only the material is disposed.
    (this.object.material as THREE.Material).dispose();
  }
}
