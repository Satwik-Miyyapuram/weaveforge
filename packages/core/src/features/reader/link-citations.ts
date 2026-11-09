/** Types for link-citations. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { PageTextItem } from "../../reader/selection-to-anchor.js";
import type { CitationMention, ParsedReference, PdfLink } from "./analysis/analysis-types.js";

export type { PdfLink };

export interface CoveredTextSpan {
  link: PdfLink;
  /** Offsets into the page-text convention string, trimmed of separators. */
  start: number;
  end: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface LinkCitationsFns {
  /**
 * The reference entry a link destination lands on: the entry on that page
 * whose first line starts at or just below the destination point. `/XYZ`
 * destinations from hyperref sit a little above the entry's baseline, so the
 * nearest entry *below* the point (with a small tolerance) is the one meant;
 * in two-column layouts the same `y` occurs in both columns, so an entry in
 * the destination's column wins over one in the other.
 */
  referenceForDestination(dest: { page: number; x?: number; y?: number }, refs: readonly ParsedReference[]): ParsedReference | null;
  /**
 * The text spans a set of link boxes covers, under the page-text convention
 * (items concatenated, a newline after each `hasEOL` item). A text item under
 * a box contributes the part of itself the box covers, proportionally by
 * character; a link that covers the `16` of `[16]` gives `16`. Adjacent
 * links in one bracket (`[5, 2, 35]` is three links) keep separate spans.
 * `[38, 2, 9]` is one text item under three links; a box's proportional span
 * can take a neighbour's comma or bracket with it, so edges are trimmed of
 * separators and the caller widens back to brackets that belong to the span.
 */
  coveredTextSpans(page: { number: number; items: readonly PageTextItem[] }, links: readonly PdfLink[]): { spans: CoveredTextSpan[]; text: string };
  /**
 * Citation mentions from a page's links: for each internal link that resolves
 * to an entry, the span of page text under its box. The document's own links
 * are authoritative — a LaTeX PDF has a real `/Link` over `[16]`, and that is
 * trusted before any regex parsing. Links that cover no text (an empty box, a
 * figure) give nothing; each mention carries its source and full confidence.
 */
  linkCitationMentions(page: { number: number; items: readonly PageTextItem[] }, links: readonly PdfLink[], refs: readonly ParsedReference[]): CitationMention[];
}
