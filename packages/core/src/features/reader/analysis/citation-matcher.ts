/**
 * Match one page's citations and map them back to real PDF rectangles.
 *
 * The pipeline is the reference Scholar reader's, ported verbatim: the text
 * candidates (`[12]`, "Smith et al. 2019") are the mentions, the document's
 * own internal links only *support* them, and what the links name that no
 * candidate claims is coalesced with its neighbours. That is what keeps an
 * author-year citation hyperref set as two boxes — `Kingma & Welling` and
 * `(2014)` — one citation rather than two.
 */

import { itemToRect, type PageTextItem } from "../../../reader/selection-to-anchor.js";
import type { CitationMention, PageTextRange, ParsedReference, PdfLink } from "./analysis-types.js";
import type { CitationStyle } from "../find-citation-mentions.js";
import type { OutlineTextItem } from "../outline-from-text.js";
import { nativeCitationMentions } from "./pdf-links.js";
import { findPatternCitationMentions } from "./citations.js";
import { assemblePageCitations } from "./citation-assembly.js";

export interface PageCitationInput {
  number: number;
  text: string;
  /** Raw pdf.js items — geometry, superscript sizes. */
  items: readonly PageTextItem[];
  /** The same runs as outline items, for the pattern finder. */
  outlineItems: readonly OutlineTextItem[];
  links?: readonly PdfLink[];
}

/**
 * PDF user-space rects covering `[start, end)` of the page text, one per
 * text run the span crosses, in reading order. Sub-run ranges interpolate
 * across the run's width, as `itemToRect` does.
 */
export function mentionRects(items: readonly PageTextItem[], start: number, end: number): number[][] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const rects: number[][] = [];
  let cursor = 0;
  for (const item of items) {
    const from = cursor;
    const to = from + item.str.length;
    cursor = to + (item.hasEOL ? 1 : 0);
    if (to <= start || from >= end) continue;
    const rect = itemToRect(item, Math.max(0, start - from), Math.min(item.str.length, end - from));
    if (rect && rect[2]! > rect[0]!) rects.push(rect);
  }
  return rects;
}

/**
 * Whether the document cites by superscripts, which `detectCitationStyle`
 * cannot see from text alone — a Vancouver paper has no brackets and no
 * "(Author year)" anywhere, so its style reads as none. Two or more small
 * digit runs tucked after a word on pages before the bibliography is the
 * signature; table exponents rarely trail prose punctuation this way.
 */
export function looksLikeSuperscriptStyle(
  pages: readonly { number: number; outlineItems: readonly OutlineTextItem[] }[],
  bodyFontSize: number,
  firstReferencePage: number,
): boolean {
  if (!bodyFontSize) return false;
  let hits = 0;
  for (const page of pages) {
    if (page.number >= firstReferencePage) continue;
    let previous = "";
    for (const item of page.outlineItems) {
      if (!item.str) continue;
      if (
        item.fontSize > 0 &&
        item.fontSize <= 0.75 * bodyFontSize &&
        /^\d{1,3}(?:\s*[,–\-]\s*\d{1,3})*$/.test(item.str) &&
        /\p{L}[.,;:)?\]"”]?$/u.test(previous)
      ) {
        hits += 1;
      }
      if (item.str.trim()) previous = item.str;
    }
  }
  return hits >= 2;
}

/**
 * One page's citations, as the reference reader assembles them: the native
 * links read as support, the pattern finder's mentions, and the two combined
 * over the text candidates. `referenceRanges` are the bibliography's own
 * spans, where nothing is a citation.
 */
export function matchPageCitations(
  page: PageCitationInput,
  references: readonly ParsedReference[],
  _bodyFontSize: number,
  style: CitationStyle | null,
  referenceRanges: readonly PageTextRange[] = [],
): CitationMention[] {
  const analyzePage = { pageNumber: page.number, items: page.items, links: page.links ?? [] };
  const native = nativeCitationMentions(analyzePage, references, referenceRanges);
  const patterns = findPatternCitationMentions(
    { number: page.number, items: page.items, text: page.text },
    references,
    style,
    "fixed",
    referenceRanges,
  );
  return assemblePageCitations(analyzePage, native, patterns, referenceRanges);
}
