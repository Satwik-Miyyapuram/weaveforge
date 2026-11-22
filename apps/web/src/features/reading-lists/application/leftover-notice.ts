import type { ReadingListLegacyLeftover } from "@weaveforge/core";

/**
 * The lists screen's notice for 0.9.6 members that are not items yet. Saving a
 * list does not clear them: each one is retried when the lists load, and moves
 * in once its link resolves. A paper that already holds a different note for
 * the list stays a leftover until one of the two notes is changed.
 */
export function leftoverNoticeText(
  leftovers: readonly ReadingListLegacyLeftover[],
  listName: (listId: string) => string,
): string {
  const one = leftovers.length === 1;
  const named = leftovers
    .map((l) => `${l.legacyLink ?? l.paperId ?? l.vaultPageId ?? "?"} (list ${listName(l.listId)})`)
    .join(", ");
  return (
    `${one ? "One member" : `${leftovers.length} members`} from an older list file ${one ? "is" : "are"} ` +
    `not shown as ${one ? "an item" : "items"} yet: ${named}. ` +
    "Each one is retried when the lists load; it moves in once its link resolves to a paper or note. " +
    "If a paper already holds a different note for this list, change one of the two notes."
  );
}
