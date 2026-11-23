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
export declare class ReadCache {
    private store;
    private defaultTtlMs;
    constructor(config?: Pick<NetworkConfig, 'cacheTtlMs'>);
    /**
     * Return a cached value if present and not expired, otherwise call
     * `loader`, cache the result, and return it.
     *
     * If `loader` throws, the error propagates to the caller unchanged.
     * If storing the result fails for any reason, the value is still returned.
     */
    get<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T>;
    /** Remove a single entry (e.g. after a write that affects it). */
    invalidate(key: string): void;
    /** Remove all entries whose key starts with `prefix`. */
    invalidatePrefix(prefix: string): void;
    /** Remove all entries. */
    clear(): void;
    /** Number of entries currently in the store (including expired ones). */
    get size(): number;
}
//# sourceMappingURL=readCache.d.ts.map