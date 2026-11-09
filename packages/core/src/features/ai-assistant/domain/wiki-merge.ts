/** Types for wiki-merge. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export interface MergeInput {
  id: string;
  title: string;
  body: string;
  aliases?: readonly string[];
  sources?: readonly string[];
}

export interface Contradiction {
  /** The statement from the page being kept. */
  fromPrimary: string;
  /** The conflicting statement from the page being merged in. */
  fromSecondary: string;
}

export interface MergeResult {
  title: string;
  body: string;
  aliases: string[];
  sources: string[];
  contradictions: Contradiction[];
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface WikiMergeFns {
  /**
 * Merge `secondary` into `primary`.
 *
 * `primary` keeps its title; the other title becomes an alias, so links to
 * either continue to resolve after the merge.
 */
  mergeWikiPages(primary: MergeInput, secondary: MergeInput): MergeResult;
}
