import type { SearchKind } from "@weaveforge/core";
import type { WorkspaceSearchFn } from "@/lib/hooks/use-search-index";
import { readyCore } from "@/lib/rust-core";

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

  // Matching, ranking and the unindexed fallback live in Rust (`rank_filter`).
  // Ranked items first; unindexed matches keep their list order after them.
  const order = readyCore().rankFilterOrder(
    trimmed,
    hits.map((hit) => hit.entityId),
    items.map((item) => ({ id: idOf(item), fallbackText: fallbackText(item) })),
  );
  return order.map((index: number) => items[index] as T);
}
