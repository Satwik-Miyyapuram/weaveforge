"use client";

import { useCallback, useEffect, useState } from "react";
import type { SearchHit, SearchQueryOptions } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";

export type WorkspaceSearchFn = (query: string, options?: SearchQueryOptions) => readonly SearchHit[];

/**
 * Warm the workspace search index and hand back a query function.
 *
 * Returning the function rather than a readiness flag is deliberate: its
 * identity changes once the index lands, so a `useMemo` that ranks results can
 * depend on it honestly instead of on a tick it never reads.
 *
 * The build is deferred to an idle callback so first paint is never delayed by
 * tokenizing the corpus. Failure is silent — every caller falls back to
 * substring matching, so a failed build costs ranking, never the search box.
 *
 * `warm` gates the build. Building reads the whole project — every entity, one
 * request each — and the jump palette that asks for it is mounted on every
 * screen, so warming on mount charged every page load for a search nobody had
 * run yet. Callers pass true when the user reaches for search: the palette when
 * it opens, a list when a query is typed.
 */
export function useSearchIndex(warm = false): WorkspaceSearchFn {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!warm) return;
    let cancelled = false;
    const start = () => {
      void getContainer()
        .search.ensure()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    };

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    const handle = idle ? idle(start, { timeout: 2_000 }) : window.setTimeout(start, 200);

    return () => {
      cancelled = true;
      const cancelIdle = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (idle && cancelIdle) cancelIdle(handle);
      else window.clearTimeout(handle);
    };
  }, [warm]);

  return useCallback(
    (query: string, options?: SearchQueryOptions) => {
      if (!ready) return [];
      try {
        return getContainer().search.search(query, options);
      } catch {
        return [];
      }
    },
    [ready],
  );
}
