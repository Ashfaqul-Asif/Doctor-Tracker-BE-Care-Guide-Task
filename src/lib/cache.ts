import { env } from '../config/env.js';

/**
 * Dashboard aggregations are read-heavy and tolerant of being a couple of minutes
 * stale (FR-20), so they are memoized here rather than re-run per request.
 *
 * This is an in-process TTL map, which is correct for a single instance and wrong
 * for several: two API replicas would hold independent, independently-stale caches.
 * The interface is deliberately driver-shaped so swapping in Redis is a
 * one-file change — see docs/architecture.md.
 */

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

class MemoryCache {
  private readonly store = new Map<string, CacheEntry>();

  /**
   * Producers currently running, keyed the same way as `store`.
   *
   * Without this, N requests arriving on a cold key all miss, all run the aggregation,
   * and all write the same result — the stampede is worst exactly when it hurts most,
   * right after an invalidation on a busy dashboard.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlSeconds: number = env.CACHE_TTL_SECONDS): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Any doctor/patient mutation invalidates the aggregates derived from them. */
  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    // In-flight producers for these keys started before the write and would otherwise
    // finish afterwards and cache what they read — a value the mutation just made stale.
    // Dropping them here makes `wrap` discard their results instead.
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key);
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  /**
   * Read-through helper: `cache.wrap(key, ttl, () => expensiveAggregation())`.
   *
   * Concurrent misses on the same key share one `produce()` call rather than each
   * running their own. A failed producer is not cached — it is only removed from the
   * in-flight map, so the next caller retries instead of inheriting the rejection.
   */
  async wrap<T>(key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const pending: Promise<T> = produce()
      .then((value) => {
        // Only cache if this producer is still the current one for the key. If an
        // invalidation landed while it was running it was dropped from the map, and
        // writing the now-stale value back would silently undo that invalidation.
        if (this.inFlight.get(key) === pending) this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  /** Lazy expiry alone would let never-read keys accumulate. */
  startSweeper(intervalMs = 60_000): void {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.expiresAt <= now) this.store.delete(key);
      }
    }, intervalMs);
    timer.unref();
  }
}

export const cache = new MemoryCache();

/** Namespaces, so invalidation can be coarse and obvious. */
export const CacheKeys = {
  dashboard: 'dashboard:',
  facets: 'facets:',
} as const;

export function invalidateDerivedCaches(): void {
  cache.invalidatePrefix(CacheKeys.dashboard);
  cache.invalidatePrefix(CacheKeys.facets);
}
