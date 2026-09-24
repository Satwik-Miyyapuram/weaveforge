"use client";

import { useCallback, useEffect, useState } from "react";
import type { SearchHit, SearchQueryOptions } from "@weaveforge/core";
import { getContainer, type AppContainer } from "@/bootstrap";
import { SEMANTIC_CHANGED_EVENT, restoreSemanticSearch } from "@/features/search/application/semantic-search";
import { startAutoIndex } from "@/features/search/application/auto-index-library";

export type WorkspaceSearchFn = (query: string, options?: SearchQueryOptions) => readonly SearchHit[];

/**
 * The same query, answered later, for callers that can wait.
 *
 * **This exists because the semantic arm was unreachable.** `enableSemanticSearch`
 * downloads the encoder, embeds the corpus and calls
 * `container.search.setSemanticIndex(...)` — and the only surface that consulted
 * it was `WorkspaceSearch.searchHybrid`, whose only callers were its own tests.
 * Every screen searched through this hook, which called the keyword-only
 * `search`. So the feature could finish successfully, store four thousand
 * embeddings, and change not one result: the preference was saved, the model was
 * in the cache, and the answer to every query was still keyword ranking.
 *
 * Same shape as the synchronous function so a caller can swap one for the other,
 * but it returns a promise because embedding the query is a forward pass through
 * the encoder.
 */
export type WorkspaceHybridSearchFn = (
  query: string,
  options?: SearchQueryOptions,
) => Promise<readonly SearchHit[]>;

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
  deps: { container?: () => AppContainer } = {},
): WorkspaceSearchFn {
  return useSearchIndexState(warm, deps).search;
}

/**
 * The hook's body, returning readiness as well as the function.
 *
 * `useSearchIndex` keeps its original signature — a bare function, which is what
 * its three callers destructure — while the hybrid wrapper needs to know whether
 * the index landed. Returning it from here rather than re-deriving it keeps one
 * piece of state instead of two that can disagree.
 */
function useSearchIndexState(
  warm: boolean,
  deps: { container?: () => AppContainer },
): { search: WorkspaceSearchFn; ready: boolean } {
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
          // The semantic arm is re-attached here, from the first search, and
          // not at boot: it loads an encoder, and a session that never searches
          // should not pay for one. Only when the reader turned it on.
          if (container === getContainer) {
            void restoreSemanticSearch();
            void startAutoIndex();
          }
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

  const search = useCallback(
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
  return { search, ready };
}

/**
 * The same hook, plus a query function that can use the semantic arm.
 *
 * Returned as a pair rather than replacing `useSearchIndex`, because the two
 * callers have genuinely different needs: the palette re-ranks on every keystroke
 * and cannot await a forward pass per character, while a results view can. Both
 * go through the same index and the same readiness gate.
 *
 * `searchHybrid` falls back to the keyword ranking when no encoder is attached
 * (`WorkspaceSearch.searchHybrid` does that itself), so a caller using this
 * function behaves identically to one using the plain hook until the reader turns
 * semantic search on — which is the only way "turn it on" can be a change of
 * results rather than a change of nothing.
 */
export function useHybridSearchIndex(
  warm = false,
  deps: { container?: () => AppContainer } = {},
): { search: WorkspaceSearchFn; searchHybrid: WorkspaceHybridSearchFn; ready: boolean } {
  const { search, ready } = useSearchIndexState(warm, deps);
  const container = deps.container ?? getContainer;
  // Bumped when the semantic arm attaches or detaches. `searchHybrid` depends on
  // it, so its identity changes and a view that already answered the query with
  // keywords alone asks again — otherwise the first query after a reload, typed
  // while the vectors were still loading, never got the semantic answer.
  const [semanticEpoch, setSemanticEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setSemanticEpoch((n) => n + 1);
    globalThis.addEventListener?.(SEMANTIC_CHANGED_EVENT, bump);
    return () => globalThis.removeEventListener?.(SEMANTIC_CHANGED_EVENT, bump);
  }, []);
  const searchHybrid = useCallback<WorkspaceHybridSearchFn>(
    async (query, options) => {
      try {
        return await container().search.searchHybrid(query, options);
      } catch {
        // The keyword arm is the one that always works; a failure here must cost
        // ranking, never the results.
        return search(query, options);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semanticEpoch is the re-query signal
    [container, search, semanticEpoch],
  );
  return { search, searchHybrid, ready };
}
