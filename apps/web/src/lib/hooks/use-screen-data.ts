"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProject } from "@/features/projects";
import {
  getScreenCache, isScreenCacheFresh, screenCacheKey, setScreenCache, } from "@/lib/cache/screen-cache";
import { idbGetScreenCache, idbSetScreenCache } from "@/lib/cache/screen-cache-idb";
import { perfNow, recordPerf, recordPerfSince } from "@/lib/perf";
import { formatError } from "@/lib/format-error";
import type { ScreenId } from "@/lib/screens";

/**
 * Load screen data with stale-while-revalidate: show cached payload instantly on
 * remount, refresh in the background.
 *
 * Three things write to this state — a memory-cache hit, an IndexedDB restore
 * and the network — and only the network is allowed the last word. Ordering is
 * enforced with two counters rather than one, because the two rules are not the
 * same rule:
 *
 *   * `requestSeq` (bumped when a request *starts*) decides which network answer
 *     is the newest. Without it, a project switch could paint the previous
 *     project's screen when the older request happened to answer last.
 *   * `completedLoads` (bumped when a request *finishes*) decides whether a
 *     restored payload is still worth showing. A single shared counter cannot
 *     answer both: the reload effect runs after the restore effect, so the
 *     restore would always observe a newer counter and drop every payload it
 *     read — silently disabling the offline restore this hook exists for.
 *
 * `screen` is a {@link ScreenId} rather than a string because it *is* a cache
 * key: a misspelt one is not an error anywhere, it is a screen whose data is
 * never cleared on a write and never warmed on a hover.
 *
 * The IndexedDB restore is best-effort and the network write to it is observed
 * rather than fired and forgotten: a cache that stops working without saying so
 * is the failure this hook exists to prevent, and the write is the only place
 * that failure would be visible. (It cannot reject today — `idbSetScreenCache`
 * swallows its own errors — which is the other half of why the ceiling on it
 * needs to be measurable.)
 */
export function useScreenData<T>(screen: ScreenId, load: () => Promise<T>) {
  const { current } = useProject();
  const projectId = current?.id ?? null;
  const cacheKey = screenCacheKey(projectId, screen);

  const [data, setData] = useState<T | null>(() => getScreenCache<T>(cacheKey) ?? null);
  const [loading, setLoading] = useState(() => getScreenCache<T>(cacheKey) == null);
  const [error, setError] = useState<string | null>(null);

  /** Identifies the newest request. Only its answer may be written. */
  const requestSeq = useRef(0);
  /** How many network loads have landed; a restore that predates one is stale. */
  const completedLoads = useRef(0);
  /**
   * The loader is a caller-supplied closure, so it is deliberately not a
   * dependency: a screen that passes an inline lambda would otherwise re-issue
   * its whole load on every render. Holding the latest closure in a ref makes
   * that explicit instead of accidental.
   */
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (getScreenCache<T>(cacheKey) != null) return;
    let active = true;
    const startedAt = perfNow();
    const loadsAtStart = completedLoads.current;
    void idbGetScreenCache<T>(cacheKey).then((cached) => {
      recordPerfSince(`screen.${screen}.idb_ms`, startedAt);
      if (!active || cached == null) return;
      // A payload from a previous session is worth showing only while nothing
      // fresher has arrived. If a load has already landed, this one loses.
      if (completedLoads.current !== loadsAtStart) return;
      if (getScreenCache<T>(cacheKey) != null) return;
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
    const seq = (requestSeq.current += 1);
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
      const fresh = await loadRef.current();
      // Superseded while in flight — a manual refresh, or a project switch.
      if (seq !== requestSeq.current) return;
      // `Date.now()` because this payload *was* fetched now; the restore path
      // above passes the time the server answered, which is a different moment.
      setScreenCache(cacheKey, fresh, Date.now());
      // Observed, not discarded. This promise cannot reject today —
      // `idbSetScreenCache` catches everything internally so a quota error never
      // reaches a caller — but a write nobody can observe is a write nobody can
      // measure, and the offline restore is the feature whose quiet failure is
      // invisible until the network is gone. Recording the failure here is what
      // would make a regression in the cache show up as a number rather than as
      // "the app is offline and the cache is empty and nothing said why".
      void idbSetScreenCache(cacheKey, fresh).catch(() => {
        recordPerf(`screen.${screen}.idb_write_failed`, 1);
      });
      setData(fresh);
      completedLoads.current += 1;
      recordPerfSince(`screen.${screen}.fetch_ms`, startedAt);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(formatError(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [cacheKey, screen]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading: loading && data == null, error, reload, setData };
}
