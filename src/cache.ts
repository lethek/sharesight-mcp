/** A key-value cache whose entries may disappear at any time. Callers must work when `get` finds nothing. */
export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}

/** In-process cache with a time limit and a cap on the number of entries. A TTL of 0 or less turns caching off. */
export class MemoryCache<V> implements Cache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);

      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) {
      return;
    }

    // Deleting first moves a refreshed key to the end, so the oldest entry is always the first one in the map
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}
