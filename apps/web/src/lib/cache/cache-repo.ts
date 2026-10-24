/**
 * In-memory caching decorator for repositories.
 *
 * Wraps a repository so read methods are memoized per active project, and any
 * write clears the cache. This makes switching tabs instant — screens that call
 * `list()`/`getTree()` on mount hit the cache instead of refetching from
 * the database every time — while writes keep the cache correct (no stale data).
 *
 * The cache lives for the lifetime of the page (the container is a singleton),
 * so it survives client-side tab navigation but not a full reload. Reads are
 * keyed by (projectId, method, args); concurrent identical reads share one
 * in-flight promise (deduped). Settled reads are returned without re-fetching
 * for {@link SCREEN_REVALIDATE_AFTER_MS}, the same window the screen cache
 * trusts, so a screen's revalidation reaches the store. Past it the read is
 * refetched; if that fails (offline), the older answer is served instead.
 * A failed read is not cached, and a read in flight when the cache is cleared
 * is not cached either: it started before the write that cleared it.
 */
import { SCREEN_REVALIDATE_AFTER_MS } from "@/lib/cache/cache-policy";
import type { ResourceType } from "@/lib/cache/cache-invalidation-map";
import { cacheWriteNotify, registerRepoCacheEntry } from "@/lib/cache/project-lww-invalidator";

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

/** When each settled key was stored, per settled map (shared maps share it). */
const settledTimes = new WeakMap<Map<string, unknown>, Map<string, number>>();

function timesFor(settled: Map<string, unknown>): Map<string, number> {
  let times = settledTimes.get(settled);
  if (!times) {
    times = new Map();
    settledTimes.set(settled, times);
  }
  return times;
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
  const settledAt = timesFor(settled);
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
          if (settled.has(key) && Date.now() - (settledAt.get(key) ?? 0) < SCREEN_REVALIDATE_AFTER_MS) {
            return Promise.resolve(settled.get(key));
          }
          // `cache` holds reads in flight only. A clear removes `p`, and a read
          // that finds itself gone was overtaken by a write: answer, don't keep.
          const hit = cache.get(key);
          if (hit) return hit;
          const p: Promise<unknown> = Promise.resolve(fn.apply(target, args)).then(
            (v) => {
              if (cache.get(key) === p) {
                cache.delete(key);
                settled.set(key, v);
                settledAt.set(key, Date.now());
              }
              return v;
            },
            (err) => {
              if (cache.get(key) !== p) throw err;
              cache.delete(key);
              if (settled.has(key)) return settled.get(key);
              throw err;
            },
          );
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
