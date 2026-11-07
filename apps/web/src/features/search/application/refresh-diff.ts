import type { SearchDoc } from "@weaveforge/core";

/** What a partial refresh has to touch, and the prints to remember after it. */
export interface RefreshDiff {
  /** Held ids with no fresh document: deleted since the last refresh. */
  remove: string[];
  /** Fresh documents that are new, changed, or not provably unchanged. */
  add: SearchDoc[];
  prints: Map<string, string>;
}

/**
 * Compare a refreshed kind's fresh documents with what the index holds.
 *
 * Tokenizing is the cost of a refresh, so a document whose every field
 * (degree included, it ranks) matches the print from last time is skipped.
 * A document with no print is re-added: `add` replaces an existing id.
 */
export function diffRefresh(
  prints: ReadonlyMap<string, string>,
  held: readonly string[],
  fresh: readonly SearchDoc[],
): RefreshDiff {
  const next = new Map(prints);
  const heldSet = new Set(held);
  const freshIds = new Set<string>();
  const add: SearchDoc[] = [];
  for (const doc of fresh) {
    freshIds.add(doc.id);
    const print = JSON.stringify(doc);
    if (!(heldSet.has(doc.id) && prints.get(doc.id) === print)) add.push(doc);
    next.set(doc.id, print);
  }
  const remove = held.filter((id) => !freshIds.has(id));
  for (const id of remove) next.delete(id);
  return { remove, add, prints: next };
}
