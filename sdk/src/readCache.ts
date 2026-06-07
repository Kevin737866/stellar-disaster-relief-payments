/**
 * Lightweight in-memory TTL cache for high-frequency read operations.
 *
 * Follows the same standalone-utility pattern as TransactionPoller.
 * TTL defaults are read from NetworkConfig.cacheTtlMs; individual call-sites
 * may override via the `ttlMs` parameter.
 *
 * Cache failures (e.g. serialization errors) are swallowed so the caller
 * always falls back to the original data source.
 */

import { NetworkConfig } from './types';

const DEFAULT_TTL_MS = 30_000; // 30 s

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ReadCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private defaultTtlMs: number;

  constructor(config?: Pick<NetworkConfig, 'cacheTtlMs'>) {
    this.defaultTtlMs = config?.cacheTtlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Return a cached value if present and not expired, otherwise call
   * `loader`, cache the result, and return it.
   *
   * If `loader` throws, the error propagates to the caller unchanged.
   * If storing the result fails for any reason, the value is still returned.
   */
  async get<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() < entry.expiresAt) {
      return entry.value;
    }

    const value = await loader();

    try {
      this.store.set(key, {
        value,
        expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      });
    } catch {
      // swallow — value is still returned
    }

    return value;
  }

  /** Remove a single entry (e.g. after a write that affects it). */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all entries whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Number of entries currently in the store (including expired ones). */
  get size(): number {
    return this.store.size;
  }
}
