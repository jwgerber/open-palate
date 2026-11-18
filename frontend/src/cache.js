/**
 * Simple in-memory TTL cache for API responses.
 *
 * Usage:
 *   const cache = createCache(5 * 60 * 1000); // 5 minute TTL
 *   const data = await cache.get('coffees', () => api.get('/tasting/coffees'));
 *   cache.invalidate('coffees'); // Force next fetch
 *   cache.invalidateAll(); // Clear everything
 */

export function createCache(defaultTtlMs = 5 * 60 * 1000) {
  const entries = new Map();

  return {
    /**
     * Get cached value or fetch fresh data.
     * @param {string} key - Cache key
     * @param {() => Promise<any>} fetcher - Function that returns a promise with fresh data
     * @param {number} [ttlMs] - Override TTL for this entry
     */
    async get(key, fetcher, ttlMs) {
      const ttl = ttlMs ?? defaultTtlMs;
      const cached = entries.get(key);
      // A concurrent caller already started this fetch — share its promise
      // (same pattern as the api.js 401-refresh dedup).
      if (cached?.promise) {
        return cached.promise;
      }
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.data;
      }
      const promise = Promise.resolve()
        .then(fetcher)
        .then(
          (data) => {
            entries.set(key, { data, timestamp: Date.now() });
            return data;
          },
          (err) => {
            entries.delete(key); // don't cache failures
            throw err;
          },
        );
      entries.set(key, { promise });
      return promise;
    },

    /** Invalidate a specific key (next get will fetch fresh). */
    invalidate(key) {
      entries.delete(key);
    },

    /** Invalidate all entries matching a prefix. */
    invalidatePrefix(prefix) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },

    /** Clear the entire cache. */
    invalidateAll() {
      entries.clear();
    },
  };
}

