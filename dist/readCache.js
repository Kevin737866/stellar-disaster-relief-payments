"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadCache = void 0;
const DEFAULT_TTL_MS = 30000; // 30 s
class ReadCache {
    constructor(config) {
        this.store = new Map();
        this.defaultTtlMs = config?.cacheTtlMs ?? DEFAULT_TTL_MS;
    }
    /**
     * Return a cached value if present and not expired, otherwise call
     * `loader`, cache the result, and return it.
     *
     * If `loader` throws, the error propagates to the caller unchanged.
     * If storing the result fails for any reason, the value is still returned.
     */
    async get(key, loader, ttlMs) {
        const entry = this.store.get(key);
        if (entry && Date.now() < entry.expiresAt) {
            return entry.value;
        }
        const value = await loader();
        try {
            this.store.set(key, {
                value,
                expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
            });
        }
        catch {
            // swallow — value is still returned
        }
        return value;
    }
    /** Remove a single entry (e.g. after a write that affects it). */
    invalidate(key) {
        this.store.delete(key);
    }
    /** Remove all entries whose key starts with `prefix`. */
    invalidatePrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) {
                this.store.delete(key);
            }
        }
    }
    /** Remove all entries. */
    clear() {
        this.store.clear();
    }
    /** Number of entries currently in the store (including expired ones). */
    get size() {
        return this.store.size;
    }
}
exports.ReadCache = ReadCache;
//# sourceMappingURL=readCache.js.map