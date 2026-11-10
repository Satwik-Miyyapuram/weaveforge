import { rust } from "../../../shared/rust.js";

/** Which id on a reading-list join row names the resource: the paper, the vault page, or either (paper first). */
export type ListMembershipKey = "paper" | "vaultPage" | "either";

/**
 * Which list holds which resource: `listId -> the ids in it`.
 *
 * Rust `reading_lists::reading_list::list_membership`. Every list gets an entry,
 * including the empty ones: the list filter asks `membership.get(listId)` and a
 * missing key would read as "no list selected" rather than "nothing in this list".
 * An item is one or the other kind by check constraint, so `either` reads whichever is set.
 */
export function buildListMembership(
  lists: readonly { id: string }[],
  items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[],
  key: ListMembershipKey,
): Map<string, Set<string>> {
  return rust().listMembershipByKey(lists, items, key);
}
