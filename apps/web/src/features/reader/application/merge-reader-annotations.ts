import type { ReaderAnnotation } from "@weaveforge/core";

/**
 * Merge Zotero-projected + local annotations; locals win on id collision.
 *
 * A local annotation that write-back has sent to Zotero carries the Zotero key
 * it was given, and the next pull brings the same mark back as a Zotero
 * annotation under that key. The local row is the one the reader edits, so the
 * Zotero copy of it is dropped — otherwise every synced highlight shows twice.
 */
export function mergeReaderAnnotations(
  zotero: readonly ReaderAnnotation[],
  local: readonly ReaderAnnotation[],
): ReaderAnnotation[] {
  const sentFromHere = new Set(local.map((a) => a.zoteroKey).filter((k): k is string => !!k));
  const byId = new Map<string, ReaderAnnotation>();
  for (const a of zotero) {
    if (!sentFromHere.has(a.zoteroKey ?? a.id)) byId.set(a.id, a);
  }
  for (const a of local) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => a.sortIndex.localeCompare(b.sortIndex));
}
