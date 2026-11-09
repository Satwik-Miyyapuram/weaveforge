/** Types for text-fingerprint. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface TextFingerprintFns {
  /**
 * A stable key for a document's text layer: sixteen hex characters from two
 * FNV-1a passes over the pages. Two copies of the same paper — the arXiv PDF
 * and the publisher's — hash the same when their text layers agree, so a
 * reference lookup done for one serves the other, and a re-upload of the same
 * file never re-resolves. Synchronous, so it can run where SubtleCrypto cannot.
 */
  textFingerprint(texts: readonly string[]): string;
}
