interface Entry<T> {
  users: number;
  value: Promise<T>;
  failed: boolean;
}

/**
 * Loads each key once and shares the result. acquire() and release() count
 * users, and the last release disposes the value. A failed load is retried
 * by the next acquire() in the same entry, so the users that got the error
 * and the new ones are counted together. Releasing one of them never frees
 * a value the others use.
 */
export class SharedCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly dispose: (value: T) => void,
  ) {}

  get size() {
    return this.entries.size;
  }

  acquire(key: string): Promise<T> {
    let entry = this.entries.get(key);
    if (!entry || entry.failed) {
      const value = this.load(key);
      if (entry) Object.assign(entry, { value, failed: false });
      else {
        entry = { users: 0, value, failed: false };
        this.entries.set(key, entry);
      }
      const loading = entry;
      value.catch(() => {
        if (loading.value === value) loading.failed = true;
      });
    }
    entry.users++;
    return entry.value;
  }

  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.users--;
    if (entry.users > 0) return;
    this.entries.delete(key);
    entry.value.then(this.dispose, () => {});
  }
}
