/**
 * Near-miss vocabulary matching for recognised ink text (Rust
 * `ink::vocab_match`), re-exported from index.ts.
 */

import type {
  VocabMatch,
  VocabMatchResult,
} from "./bindings.js";

export {
  matchVocabulary,
  spanDistance,
} from "../pkg/wf_wasm.js";

export {
  damerauLevenshtein,
} from "../pkg/wf_wasm.js";

export type { VocabMatch, VocabMatchResult };

