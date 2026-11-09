/** Types for wiki-index. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { WikiPageRef } from "./wiki-lint.js";

export interface WikiIndexOptions {
  /** Heading above the list. */
  heading?: string;
  /** Reference time, so a regenerated index is testable. */
  now?: () => string;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface WikiIndexFns {
  /** Marks the generated region so a rebuild never eats hand-written text. */
  readonly INDEX_MARKER_START: "<!-- weaveforge:wiki-index -->";
  readonly INDEX_MARKER_END: "<!-- /weaveforge:wiki-index -->";
  /**
 * Build the generated block.
 *
 * Sorting is by title rather than by insertion, and groups are alphabetical
 * with the symbol group last: an index is read by scanning for a name, so the
 * order that matters is the reader's, not the wiki's history.
 */
  buildWikiIndex(pages: readonly WikiPageRef[], options?: WikiIndexOptions): string;
  /**
 * Splice a freshly built index into a body, replacing any previous one.
 *
 * Text outside the markers is left exactly as written. Someone who put a note
 * at the top of the wiki root keeps it — regeneration is only entitled to the
 * region it generated.
 */
  replaceWikiIndex(body: string, index: string): string;
}
