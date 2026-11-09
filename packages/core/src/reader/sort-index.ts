/** Types for sort-index. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SortIndexFns {
  /**
 * Synthesise Zotero's annotationSortIndex.
 * Source: zotero/reader src/pdf/selection.js getSortIndex —
 * `[pageIndex.padStart(5,'0'), charOffset.padStart(6,'0'), Math.floor(top).padStart(5,'0')].join('|')`
 * so lexical sort equals reading order.
 */
  buildAnnotationSortIndex(pageIndex: number, charOffset: number, topPdfUnits: number): string;
}
