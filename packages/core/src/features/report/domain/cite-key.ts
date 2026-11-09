/** Types for cite-key. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Paper } from "../../papers/domain/paper.js";

export type CitationFormat = "latex" | "pandoc" | "footnote" | "raw";

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface CiteKeyFns {
  /**
 * A paper's preferred cite key, without uniqueness suffixing.
 *
 * Never empty: a paper with no metadata, no BibTeX and no identifier still gets
 * a key derived from its id, because an export that silently omits an entry is
 * worse than one with an ugly key in it.
 */
  resolveCiteKey(paper: Paper): string;
  /**
 * {@link resolveCiteKey}, made unique against keys already taken.
 *
 * `used` is mutated, because the caller is walking a library and the second
 * `smith2020` must know about the first.
 */
  uniqueCiteKey(paper: Paper, used: Set<string>): string;
  /**
 * Format a cite key for insertion. Empty/whitespace keys yield "" — callers
 * decide how to surface "no resolvable key" rather than inventing one here.
 */
  formatCitation(key: string, format: CitationFormat): string;
  /** Resolve then format in one step for a paper. */
  formatPaperCitation(paper: Paper, format: CitationFormat): string;
}
