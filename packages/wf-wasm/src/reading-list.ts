/**
 * Reading-list tree helper (Rust `reading_lists::reading_list`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/features/reading-lists/domain/reading-list.ts.
 */
import {
  buildListTree as rawBuildListTree,
  deepestFirstListIds as rawDeepestFirstListIds,
  listDisplayColor as rawListDisplayColor,
  listMembershipByKey as rawListMembershipByKey,
} from "../pkg/wf_wasm.js";
import type { ListMembershipKey, ReadingList, ReadingListTreeNode } from "./bindings.js";
/** The reading list shapes callers type their state with. */
export type { ListMembershipKey, ReadingList, ReadingListItem, ReadingListTreeNode } from "./bindings.js";

export function buildListTree(lists: readonly ReadingList[]): ReadingListTreeNode[] {
  return rawBuildListTree(lists) as ReadingListTreeNode[];
}

/** The list and every list below it, deepest first (children before their parent). */
export function deepestFirstListIds(listId: string, lists: readonly ReadingList[]): string[] {
  return rawDeepestFirstListIds(listId, lists) as string[];
}

/** A list's own colour, or a stable hue hashed from its name. */
export function listDisplayColor(list: ReadingList): string {
  return rawListDisplayColor(list) as string;
}

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
