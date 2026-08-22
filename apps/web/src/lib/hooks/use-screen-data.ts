"use client";

import { useCallback, useEffect, useState } from "react";
import { useProject } from "@/features/projects";
import {
  getScreenCache, isScreenCacheFresh, screenCacheKey, setScreenCache, } from "@/lib/cache/screen-cache";
import { idbGetScreenCache, idbSetScreenCache } from "@/lib/cache/screen-cache-idb";
import { perfNow, recordPerf, recordPerfSince } from "@/lib/perf";
import { formatError } from "@/lib/format-error";

/**
 * Load screen data with stale-while-revalidate: show cached payload instantly on
 * remount, refresh in the background.
 */
export function useScreenData<T>(screen: string, load: () => Promise<T>) {
  const { current } = useProject();
  const projectId = current?.id ?? null;
  const cacheKey = screenCacheKey(projectId, screen);

  const [data, setData] = useState<T | null>(() => getScreenCache<T>(cacheKey) ?? null);
  const [loading, setLoading] = useState(() => getScreenCache<T>(cacheKey) == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getScreenCache<T>(cacheKey) != null) return;
    let active = true;
    const startedAt = perfNow();
    void idbGetScreenCache<T>(cacheKey).then((cached) => {
      recordPerfSince(`screen.${screen}.idb_ms`, startedAt);
      if (!active || cached == null) return;
      // Stamped with when it was fetched, not now: a payload restored after a
      // reload must not count as fresh, or the revalidation below is skipped.
      setScreenCache(cacheKey, cached.value, cached.fetchedAt);
      setData(cached.value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [cacheKey, screen]);

  const reload = useCallback(async () => {
    const startedAt = perfNow();
    const cached = getScreenCache<T>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      recordPerf(`screen.${screen}.memory_cache_hit`, 1);
      if (isScreenCacheFresh(cacheKey)) return;
    } else {
      recordPerf(`screen.${screen}.memory_cache_hit`, 0);
      setLoading(true);
    }
    setError(null);
    try {
      const fresh = await load();
      setScreenCache(cacheKey, fresh);
      void idbSetScreenCache(cacheKey, fresh);
      setData(fresh);
      recordPerfSince(`screen.${screen}.fetch_ms`, startedAt);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [cacheKey, load, screen]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading: loading && data == null, error, reload, setData };
}
