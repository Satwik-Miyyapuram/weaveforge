/** Types for text. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface TextFns {
  /** Words in plain text: runs of non-whitespace. The paper summary cap and report progress both count this way. Rust `count_words`. */
  countWords(text: string): number;
}
