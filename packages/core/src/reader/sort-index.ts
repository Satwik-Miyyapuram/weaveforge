/**
 * Synthesise Zotero's annotationSortIndex.
 * Source: zotero/reader src/pdf/selection.js getSortIndex —
 * `[pageIndex.padStart(5,'0'), charOffset.padStart(6,'0'), Math.floor(top).padStart(5,'0')].join('|')`
 * so lexical sort equals reading order.
 */
export function buildAnnotationSortIndex(
  pageIndex: number,
  charOffset: number,
  topPdfUnits: number,
): string {
  const page = Math.max(0, Math.floor(pageIndex));
  const offset = Math.max(0, Math.floor(charOffset));
  const top = Math.max(0, Math.floor(topPdfUnits));
  return [
    String(page).padStart(5, "0"),
    String(offset).padStart(6, "0"),
    String(top).padStart(5, "0"),
  ].join("|");
}
