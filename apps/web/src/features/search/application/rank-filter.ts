import type { SearchKind } from "@weaveforge/core";
import type { WorkspaceSearchFn } from "@/lib/hooks/use-search-index";

/**
 * Apply the ranked index to a screen's list while keeping entities the index
 * cannot see.
 *
 * The index is built from the workspace snapshot, which is the signed-in user's
 * own project. Screens also show items shared or pinned from other users; those
 * have no indexed document, so ranking alone would silently hide them. They
 * fall back to substring matching, which is what the whole screen used before.
 */
export interface RankFilterOptions<T> {
  items: readonly T[];
  query: string;
  kinds: readonly SearchKind[];
  /** Injected so this stays pure and testable — see `useSearchIndex`. */
  search: WorkspaceSearchFn;
  idOf(item: T): string;
  /** Text used for items absent from the index (shared/pinned). */
  fallbackText(item: T): string;
}

export function rankedFilter<T>({
  items,
  query,
  kinds,
  search,
  idOf,
  fallbackText,
}: RankFilterOptions<T>): T[] {
  const trimmed = query.trim();
  if (!trimmed) return [...items];

  const hits = search(trimmed, { kinds, limit: 500 });

  const rank = new Map<string, number>();
  hits.forEach((hit, position) => {
    if (!rank.has(hit.entityId)) rank.set(hit.entityId, position);
  });

  const lower = trimmed.toLowerCase();
  const matches = items.filter((item) => {
    if (rank.has(idOf(item))) return true;
    // Unindexed (shared/pinned) items keep the previous substring behaviour.
    return fallbackText(item).toLowerCase().includes(lower);
  });

  // Ranked items first in score order; unindexed matches keep their list order
  // after them, so a shared note never jumps above a genuinely better match.
  const UNRANKED = Number.MAX_SAFE_INTEGER;
  return matches
    .map((item, position) => ({ item, position, score: rank.get(idOf(item)) ?? UNRANKED }))
    .sort((a, b) => a.score - b.score || a.position - b.position)
    .map((entry) => entry.item);
}
