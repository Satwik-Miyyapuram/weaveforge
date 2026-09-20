import type { ReadingListItem } from "../domain/reading-list.js";

/**
 * Which list holds which resource: `listId -> the ids in it`.
 *
 * Built by hand in four places — the papers, vault and graph screens and the
 * lists facade — from the same two inputs and the same loop. The only thing that
 * differed was which id on the join row names the resource (`paperId`,
 * `vaultPageId`, and one that reads both), which is what `idOf` is for.
 *
 * A plain function rather than a class: this is a projection, and the screens
 * that need it already hold both halves. Every list gets an entry, including the
 * empty ones — the list filter asks `membership.get(listId)` and a missing key
 * would read as "no list selected" rather than "nothing in this list".
 */
export function buildListMembership<TItem extends { listId: string }>(
  lists: readonly { id: string }[],
  items: readonly TItem[],
  idOf: (item: TItem) => string | undefined,
): Map<string, Set<string>> {
  const membership = new Map<string, Set<string>>(lists.map((list) => [list.id, new Set<string>()]));
  for (const item of items) {
    const resourceId = idOf(item);
    if (resourceId) membership.get(item.listId)?.add(resourceId);
  }
  return membership;
}

/** The common case: a reading-list item that names a paper. */
export function paperIdOfItem(item: ReadingListItem): string | undefined {
  return item.paperId;
}

/** A reading-list item that names a vault page. */
export function vaultPageIdOfItem(item: ReadingListItem): string | undefined {
  return item.vaultPageId;
}

/**
 * Either id on the join row, paper first.
 *
 * The graph screen links papers and notes through one membership, and an item is
 * one or the other — `reading_list_items` has a check constraint saying so.
 * Preferring the paper is what the copy this replaces did.
 */
export function resourceIdOfItem(item: ReadingListItem): string | undefined {
  return item.paperId ?? item.vaultPageId;
}
