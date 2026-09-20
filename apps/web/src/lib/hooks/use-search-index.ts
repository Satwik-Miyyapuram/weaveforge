"use client";

import { useCallback, useEffect, useState } from "react";
import type { SearchHit, SearchQueryOptions } from "@weaveforge/core";
import { getContainer, type AppContainer } from "@/bootstrap";

export type WorkspaceSearchFn = (query: string, options?: SearchQueryOptions) => readonly SearchHit[];

/**
 * Warm the workspace search index and hand back a query function.
 *
 * Returning the function rather than a readiness flag is deliberate: its
 * identity changes once the index lands, so a `useMemo` that ranks results can
 * depend on it honestly instead of on a tick it never reads.
 *
 * The build is deferred to an idle callback so first paint is never delayed by
 * tokenizing the corpus. Failure is silent and the hook stays not-ready — every
 * caller falls back to substring matching, so a failed build costs ranking, never
 * the search box. Which is what this docstring always said and what the code did
 * not do: see the note on the `catch` below.
 *
 * `warm` gates the build. Building reads the whole project — every entity, one
 * request each — and the jump palette that asks for it is mounted on every
 * screen, so warming on mount charged every page load for a search nobody had
 * run yet. Callers pass true when the user reaches for search: the palette when
 * it opens, a list when a query is typed.
 */
export function useSearchIndex(
  warm = false,
  /**
   * Where the container comes from.
   *
   * Injected only so a test can supply a search whose build *fails* — the branch
   * `BUG-18` is about, which had no test because the hook reached for the real
   * container and a real build succeeds on a machine with a working worker and a
   * healthy IndexedDB.
   */
  deps: { container?: () => AppContainer } = {},
): WorkspaceSearchFn {
  const [ready, setReady] = useState(false);
  const container = deps.container ?? getContainer;

  useEffect(() => {
    if (!warm) return;
    let cancelled = false;
    const start = () => {
      void container()
        .search.ensure()
        .then(() => {
          if (!cancelled) setReady(true);
        })
        // Deliberately not `finally`, and deliberately not setting `ready` here.
        //
        // `ready` is what tells a caller it may use the ranked path instead of
        // its substring fallback. A build that failed has no index to rank with,
        // so marking it ready — which is what `.finally(() => setReady(true))`
        // did — turned a worker that would not start, or a corrupt IndexedDB,
        // into an empty result set on every screen, with the fallback switched
        // off and no retry. The docstring above promises "a failed build costs
        // ranking, never the search box"; until this, that was not true.
        .catch(() => undefined);
    };

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    // `globalThis.setTimeout`, not `window.setTimeout`: they are the same
    // function in a browser, and the `window` spelling made the hook impossible
    // to run anywhere else — which is why the branch above had no test.
    // The two schedulers have different handle types, hence the union.
    const handle: number | ReturnType<typeof setTimeout> = idle
      ? idle(start, { timeout: 2_000 })
      : globalThis.setTimeout(start, 200);

    return () => {
      cancelled = true;
      const cancelIdle = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (idle && cancelIdle) cancelIdle(handle as number);
      else globalThis.clearTimeout(handle);
    };
  }, [warm, container]);

  return useCallback(
    (query: string, options?: SearchQueryOptions) => {
      if (!ready) return [];
      try {
        return container().search.search(query, options);
      } catch {
        return [];
      }
    },
    [ready, container],
  );
}
