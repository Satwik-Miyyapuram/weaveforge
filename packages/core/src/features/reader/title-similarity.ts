/** Types for title-similarity. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface TitleSimilarityFns {
  /** Token-set Dice similarity, insensitive to punctuation, accents and word order. */
  titleSimilarity(left: string, right: string): number;
  isBibliographicMatch(hints: { title?: string; year?: number }, candidate: { title: string; year?: number }): boolean;
}
