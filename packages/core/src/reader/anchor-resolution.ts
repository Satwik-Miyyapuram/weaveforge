/** Types for anchor-resolution. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PdfLocus, TextPositionSelector, TextQuoteSelector } from "./pdf-locus.js";

/** Character span in extracted document (or page) text. */
export interface TextSpan {
  start: number;
  end: number;
}

export type AnchorConfidence = "high" | "low";

export interface ResolvedAnchor extends TextSpan {
  /** How the span was obtained. */
  via: "quote" | "position";
  /**
   * `high` — quote matched (unique or disambiguated).
   * `low` — position fallback only; surface "source may have changed".
   */
  confidence: AnchorConfidence;
}

export interface NormaliseWhitespaceOptions {
  /**
   * When true (default), drop leading/trailing whitespace from the result.
   * Prefix/suffix must use `trim: false` so the space abutting `exact` is kept.
   */
  trim?: boolean;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface AnchorResolutionFns {
  /**
 * Collapse whitespace runs (newlines, tabs, NBSP, soft hyphens at line ends)
 * to a single space. `map[i]` is the original-string index of the i-th
 * normalised character; `map[normalised.length]` is the exclusive end offset
 * in the original for a span covering the whole normalised string.
 */
  normaliseWhitespace(text: string, options?: NormaliseWhitespaceOptions): {
  normalised: string;
  map: number[];
};
  /**
 * Find every occurrence of `quote.exact` whose immediate prefix/suffix match.
 * Empty `exact` yields no matches. Absent prefix/suffix impose no constraint.
 * Matching uses whitespace-normalised text; returned spans are original offsets.
 */
  findQuoteMatches(text: string, quote: TextQuoteSelector): TextSpan[];
  /**
 * Among quote matches, pick the span whose `start` is nearest the stored
 * position offset. Ties keep document order (first wins).
 */
  pickNearestMatch(matches: readonly TextSpan[], position: TextPositionSelector | undefined): TextSpan | undefined;
  /**
 * Resolve a TextPositionSelector when it lies within `text` bounds and
 * `start <= end`. Returns null when the span is unusable.
 */
  resolvePositionSelector(text: string, position: TextPositionSelector): TextSpan | null;
  /**
 * Resolve a locus against extracted text: quote first (with nearest-position
 * disambiguation), then position fallback. Never throws.
 * Multiple quote hits without a position selector are `low` confidence —
 * the caller should warn rather than treat the first hit as authoritative.
 */
  resolveTextAnchor(text: string, locus: PdfLocus): ResolvedAnchor | null;
}
