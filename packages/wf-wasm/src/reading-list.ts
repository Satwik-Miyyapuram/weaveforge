/**
 * Reading-list tree helper (Rust `reading_lists::reading_list`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/reading-lists/domain/reading-list.ts.
 */
import {
  listMembershipByKey as rawListMembershipByKey,
  relationTitles as rawRelationTitles,
} from "../pkg/wf_wasm.js";
import type {
  ListMembershipKey,
  ReadingList,
  ReadingListTreeNode,
} from "./bindings.js";

export {
  buildListTree,
  deepestFirstListIds,
} from "../pkg/wf_wasm.js";

export {
  listDisplayColor,
  pendingKey,
  readingListNameMatches,
} from "../pkg/wf_wasm.js";
/** The reading list shapes callers type their state with. */
export type { ListMembershipKey, ReadingList, ReadingListItem, ReadingListTreeNode } from "./bindings.js";

/**
 * Which list holds which resource: `listId -> the ids in it`. Every list gets an entry,
 * including the empty ones. Rust `reading_lists::reading_list::list_membership`.
 */
export function listMembershipByKey(
  lists: readonly { id: string }[],
  items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[],
  key: ListMembershipKey,
): Map<string, Set<string>> {
  const pairs = rawListMembershipByKey(lists, items, key) as [string, string[]][];
  return new Map(pairs.map(([id, ids]): [string, Set<string>] => [id, new Set(ids)]));
}

/**
 * The titles of related papers joined by `, ` in the order given; an id with no title shows as
 * the id. Rust `reading_lists::extraction_keys::relation_titles`.
 */
export function relationTitles(ids: readonly string[], titleById: ReadonlyMap<string, string>): string {
  return rawRelationTitles(ids, Object.fromEntries(titleById));
}
