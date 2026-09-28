"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SearchKind } from "@weaveforge/core";
import { rankedFilter } from "@/features/search/application/rank-filter";
import { useHybridSearchIndex, type WorkspaceSearchFn } from "@/lib/hooks/use-search-index";

const NO_HITS: WorkspaceSearchFn = () => [];

/**
 * A screen's search box, answered by the same index as the big search but only
 * for this screen's kinds. Without one (e.g. git commits) it matches text.
 * Returns a filter to run over the screen's items, ranked best first.
 */
export function useScreenSearch(query: string, ...kindList: SearchKind[]) {
  const q = query.trim();
  const key = kindList.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content, not the fresh rest array
  const kinds = useMemo(() => kindList, [key]);
  const indexed = kinds.length > 0;
  // Only a typed query builds the index; an untouched list never reads the project.
  const { search: keywordSearch, searchHybrid, ready } = useHybridSearchIndex(indexed && q.length > 0);
  // The hybrid answer replaces keyword ranking once it lands, tagged with its
  // query so a slow answer never overwrites a newer one.
  const [hybrid, setHybrid] = useState<{ query: string; hits: ReturnType<WorkspaceSearchFn> } | null>(null);
  useEffect(() => {
    if (!indexed || !q || !ready) return;
    let live = true;
    void searchHybrid(q, { kinds, limit: 500 }).then((hits) => {
      if (live) setHybrid({ query: q, hits });
    });
    return () => {
      live = false;
    };
  }, [q, indexed, kinds, ready, searchHybrid]);

  return useCallback(
    <T,>(items: readonly T[], idOf: (item: T) => string, text: (item: T) => string): T[] =>
      rankedFilter({
        items,
        query: q,
        kinds,
        search: indexed
          ? (s, options) => (hybrid && hybrid.query === s.trim() ? hybrid.hits : keywordSearch(s, options))
          : NO_HITS,
        idOf,
        fallbackText: text,
      }),
    [q, kinds, indexed, hybrid, keywordSearch],
  );
}
