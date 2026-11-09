/** Types for document-search. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export interface DocumentPageText {
  /** Zero-based page index. */
  pageIndex: number;
  text: string;
}

export interface DocumentSearchMatch {
  pageIndex: number;
  /** Inclusive start offset into that page's text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface DocumentSearchFns {
  /**
 * Case-insensitive full-document search over extracted page texts.
 * Empty / whitespace-only queries return no matches.
 */
  findDocumentMatches(pages: readonly DocumentPageText[], query: string): DocumentSearchMatch[];
  /** Wraparound next/prev index into a match list. Returns -1 when empty. */
  nextMatchIndex(current: number, total: number, direction: 1 | -1): number;
}
