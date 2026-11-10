/**
 * Reader-mark digest and reading log (Rust `papers::reading_digest`), re-exported
 * from index.ts.
 */
import {
  draftReadingLog as rawDraftReadingLog,
  highlightsDigest as rawHighlightsDigest,
} from "../pkg/wf_wasm.js";

import type { DigestMark, ReadingMark, ReadingPaper } from "./bindings.js";

export type { DigestMark, ReadingMark, ReadingPaper };

/** Note markdown for the marks not already in `existing`, or "" when none are new. */
export function highlightsDigest(marks: readonly DigestMark[], existing: string): string {
  return rawHighlightsDigest(marks, existing);
}

/** A reading-log body for the local day `day` ("YYYY-MM-DD"), or "" when there was none. */
export function draftReadingLog(
  papers: readonly ReadingPaper[],
  marks: readonly ReadingMark[],
  day: string,
): string {
  return rawDraftReadingLog(papers, marks, day);
}
