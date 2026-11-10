/**
 * Reader-mark digest and reading log (Rust `papers::reading_digest`), re-exported
 * from index.ts.
 */

import type {
  DigestMark,
  ReadingMark,
  ReadingPaper,
} from "./bindings.js";

export {
  draftReadingLog,
  highlightsDigest,
} from "../pkg/wf_wasm.js";

export type { DigestMark, ReadingMark, ReadingPaper };

