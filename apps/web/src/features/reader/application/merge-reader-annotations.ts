import type { ReaderAnnotation } from "@weaveforge/core";

/** Merge Zotero-projected + local annotations; locals win on id collision. */
export function mergeReaderAnnotations(
  zotero: readonly ReaderAnnotation[],
  local: readonly ReaderAnnotation[],
): ReaderAnnotation[] {
  const byId = new Map<string, ReaderAnnotation>();
  for (const a of zotero) byId.set(a.id, a);
  for (const a of local) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => a.sortIndex.localeCompare(b.sortIndex));
}
