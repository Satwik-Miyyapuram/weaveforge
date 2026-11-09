/** Types for search-acronyms. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SearchAcronymsFns {
  /**
 * Acronyms worth indexing for a title. Usually one; empty for titles that are
 * already short or that would produce something meaningless.
 */
  acronymsForTitle(title: string): string[];
}
