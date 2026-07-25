/**
 * In-memory caching decorator for repositories.
 *
 * Wraps a repository so read methods are memoized per active project, and any
 * write clears the cache. This makes switching tabs instant — screens that call
 * `list()`/`getTree()` on mount hit the cache instead of refetching from
 * Supabase every time — while writes keep the cache correct (no stale data).
 *
 * The cache lives for the lifetime of the page (the container is a singleton),
 * so it survives client-side tab navigation but not a full reload. Reads are
 * keyed by (projectId, method, args); concurrent identical reads share one
 * in-flight promise (deduped). Settled reads are returned without re-fetching.
 * A failed read is not cached.
 */
import type { ResourceType } from "./cache-invalidation-map.js";
import { cacheWriteNotify, registerRepoCacheEntry } from "./project-lww-invalidator.js";

export type CacheRepoOpts = {
  resourceType?: ResourceType;
  sharedCache?: Map<string, Promise<unknown>>;
  sharedSettled?: Map<string, unknown>;
};

function normalizeOpts(
  opts?: CacheRepoOpts | Map<string, Promise<unknown>>,
  legacySettled?: Map<string, unknown>,
): CacheRepoOpts {
  if (opts instanceof Map) {
    return { sharedCache: opts, sharedSettled: legacySettled };
  }
  return opts ?? {};
}

export function cacheRepo<R extends object>(
  inner: R,
  reads: readonly string[],
  writes: readonly string[],
  pid: () => string | null,
  opts?: CacheRepoOpts | Map<string, Promise<unknown>>,
  legacySettled?: Map<string, unknown>,
): R {
  const { resourceType, sharedCache, sharedSettled } = normalizeOpts(opts, legacySettled);
  const cache = sharedCache ?? new Map<string, Promise<unknown>>();
  const settled = sharedSettled ?? new Map<string, unknown>();
  registerRepoCacheEntry({ resourceType, cache, settled });
  let lastPid: string | null | undefined;
  return new Proxy(inner, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      const name = String(prop);

      if (reads.includes(name)) {
        return (...args: unknown[]) => {
          const cur = pid();
          if (cur !== lastPid) {
            cache.clear();
            settled.clear();
            lastPid = cur;
          }
          const key = `${cur ?? "-"}|${name}|${JSON.stringify(args)}`;
          if (settled.has(key)) return Promise.resolve(settled.get(key));
          const hit = cache.get(key);
          if (hit) return hit;
          const p = Promise.resolve(fn.apply(target, args))
            .then((v) => {
              settled.set(key, v);
              return v;
            })
            .catch((err) => {
              cache.delete(key);
              settled.delete(key);
              throw err;
            });
          cache.set(key, p);
          return p;
        };
      }

      if (writes.includes(name)) {
        return async (...args: unknown[]) => {
          const result = await fn.apply(target, args);
          cache.clear();
          settled.clear();
          cacheWriteNotify(resourceType);
          return result;
        };
      }

      return fn.bind(target);
    },
  }) as R;
}
