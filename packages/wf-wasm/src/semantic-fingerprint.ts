/**
 * Semantic index fingerprints and passage ids (Rust `semantic_fingerprint`), re-exported from index.ts.
 * Replaces the former helpers in apps/web/src/features/search/application/semantic-index.ts.
 */
export {
  documentIdOf,
  documentIdOfPath,
  embeddableText,
  textHash,
} from "../pkg/wf_wasm.js";

