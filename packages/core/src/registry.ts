/**
 * Owns scenes by id with reference counts. A scene is detached when its last
 * user releases it.
 */
export class SceneRegistry<T extends { detach(): void }> {
  private readonly entries = new Map<string, { scene: T; refs: number }>();
  private nextId = 0;

  /** The scene under `id`, made with `create` if there is none. Without `id`, a new one under a fresh id. */
  acquire(id: string | undefined, create: () => T): { id: string; scene: T } {
    const key = id ?? `scene-${this.nextId++}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { scene: create(), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs++;
    return { id: key, scene: entry.scene };
  }

  /** Releases one use of the scene under `id`, and detaches it after the last. */
  release(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.scene.detach();
      this.entries.delete(id);
    }
  }

  get size() {
    return this.entries.size;
  }
}
