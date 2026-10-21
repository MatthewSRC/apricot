import * as THREE from "three/webgpu";

/**
 * Plays or scrubs a model's glTF animation clips. `seek` shows a clip at a
 * fraction of its length, for driving it from a gesture or a slider, and
 * `play` runs it over time.
 */
export class ClipPlayer {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly playing = new Set<string>();

  constructor(
    root: THREE.Object3D,
    private readonly clips: readonly THREE.AnimationClip[],
  ) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  /** The names of the model's clips. */
  get names() {
    return this.clips.map((clip) => clip.name);
  }

  private action(name: string) {
    let action = this.actions.get(name);
    if (!action) {
      const clip = this.clips.find((c) => c.name === name);
      if (!clip)
        throw new Error(`No animation "${name}" in this model. It has: ${this.names.join(", ") || "none"}`);
      action = this.mixer.clipAction(clip);
      action.play();
      action.paused = true;
      this.actions.set(name, action);
    }
    return action;
  }

  /** Shows clip `name` at `progress`, from 0 (start) to 1 (end). */
  seek(name: string, progress: number) {
    const action = this.action(name);
    this.playing.delete(name);
    action.paused = true;
    action.time = Math.min(1, Math.max(0, progress)) * action.getClip().duration;
    this.mixer.update(0);
  }

  /** Plays clip `name` from the start, once or looping. */
  play(name: string, { loop = false }: { loop?: boolean } = {}) {
    const action = this.action(name);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Number.POSITIVE_INFINITY : 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.play();
    this.playing.add(name);
  }

  /** Pauses clip `name` at its current time. */
  stop(name: string) {
    const action = this.actions.get(name);
    if (action) action.paused = true;
    this.playing.delete(name);
  }

  /** Advances playing clips by `delta` seconds. Returns true while any is running. */
  update(delta: number) {
    if (this.playing.size === 0) return false;
    this.mixer.update(delta);
    for (const name of [...this.playing]) {
      const action = this.actions.get(name) as THREE.AnimationAction;
      if (!action.isRunning()) this.playing.delete(name);
    }
    return this.playing.size > 0;
  }

  /** Stops all clips and frees the mixer's cached data. */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
