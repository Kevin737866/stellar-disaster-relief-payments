import { ReadCache } from './readCache';

describe('ReadCache', () => {
  let cache: ReadCache;

  beforeEach(() => {
    cache = new ReadCache({ cacheTtlMs: 1000 } as any);
  });

  describe('cache miss', () => {
    it('calls loader on first access and returns value', async () => {
      const loader = jest.fn().mockResolvedValue('data');
      const result = await cache.get('key', loader);
      expect(result).toBe('data');
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache hit', () => {
    it('returns cached value without calling loader again', async () => {
      const loader = jest.fn().mockResolvedValue('data');
      await cache.get('key', loader);
      const result = await cache.get('key', loader);
      expect(result).toBe('data');
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL expiry', () => {
    it('re-invokes loader after TTL expires', async () => {
      jest.useFakeTimers();
      const loader = jest.fn().mockResolvedValue('v1');
      await cache.get('key', loader, 500);

      jest.advanceTimersByTime(501);

      loader.mockResolvedValue('v2');
      const result = await cache.get('key', loader, 500);
      expect(result).toBe('v2');
      expect(loader).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('uses per-call TTL override instead of default', async () => {
      jest.useFakeTimers();
      const loader = jest.fn().mockResolvedValue('val');
      await cache.get('key', loader, 200);

      jest.advanceTimersByTime(201);
      await cache.get('key', loader, 200);
      expect(loader).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('invalidate', () => {
    it('removes a single entry so next get calls loader', async () => {
      const loader = jest.fn().mockResolvedValue('data');
      await cache.get('key', loader);
      cache.invalidate('key');
      await cache.get('key', loader);
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('does not affect other entries', async () => {
      const loaderA = jest.fn().mockResolvedValue('a');
      const loaderB = jest.fn().mockResolvedValue('b');
      await cache.get('a', loaderA);
      await cache.get('b', loaderB);
      cache.invalidate('a');
      await cache.get('b', loaderB);
      expect(loaderB).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidatePrefix', () => {
    it('removes all entries matching prefix', async () => {
      const loader = jest.fn().mockResolvedValue('x');
      await cache.get('ns:1', loader);
      await cache.get('ns:2', loader);
      await cache.get('other:1', loader);

      cache.invalidatePrefix('ns:');

      await cache.get('ns:1', loader);
      await cache.get('ns:2', loader);
      await cache.get('other:1', loader);

      // ns:1 and ns:2 re-fetched; other:1 served from cache
      expect(loader).toHaveBeenCalledTimes(5);
    });
  });

  describe('loader error fallback', () => {
    it('propagates loader errors without caching', async () => {
      const loader = jest.fn().mockRejectedValue(new Error('network error'));
      await expect(cache.get('key', loader)).rejects.toThrow('network error');
      // Second call also hits loader (nothing was cached)
      await expect(cache.get('key', loader)).rejects.toThrow('network error');
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      const loader = jest.fn().mockResolvedValue('v');
      await cache.get('a', loader);
      await cache.get('b', loader);
      cache.clear();
      await cache.get('a', loader);
      await cache.get('b', loader);
      expect(loader).toHaveBeenCalledTimes(4);
    });
  });

  describe('size', () => {
    it('reflects number of stored entries', async () => {
      expect(cache.size).toBe(0);
      await cache.get('x', async () => 1);
      await cache.get('y', async () => 2);
      expect(cache.size).toBe(2);
      cache.invalidate('x');
      expect(cache.size).toBe(1);
    });
  });

  describe('default TTL from config', () => {
    it('uses cacheTtlMs from config when no per-call override given', async () => {
      jest.useFakeTimers();
      const shortCache = new ReadCache({ cacheTtlMs: 100 } as any);
      const loader = jest.fn().mockResolvedValue('v');
      await shortCache.get('k', loader);

      jest.advanceTimersByTime(101);
      await shortCache.get('k', loader);
      expect(loader).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });
});
