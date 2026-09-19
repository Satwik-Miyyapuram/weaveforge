/**
 * Match citations, in priority order, and map them back to real PDF
 * rectangles.
 *
 * The priority is the one a Scholar-style reader uses:
 *
 *   1. internal PDF destinations — the document's own `/Dest` links;
 *   2. native link text/geometry — an internal link whose destination the
 *      list does not answer, but whose printed text names an entry's label;
 *   3. numeric bracket citations (`[12]`, `[3, 8–10]`);
 *   4. superscript citations (Vancouver);
 *   5. author-year citations ("Smith et al. 2019");
 *   6. a fallback fuzzy author-year pass, flagged with low confidence.
 *
 * Steps 1–2 come from `pdf-link-analysis`, 3–6 from `findCitationMentions`;
 * `matchPageCitations` merges them so a span the links own is never re-claimed
 * by a pattern, and paints every mention with the page rects it covers.
 */

import { itemToRect, type PageTextItem } from "../../../reader/selection-to-anchor.js";
import type { CitationMention, ParsedReference } from "./analysis-types.js";
import { findCitationMentions, type CitationStyle } from "../find-citation-mentions.js";
import type { OutlineTextItem } from "../outline-from-text.js";
import { analyzePageLinks } from "./pdf-link-analysis.js";

export interface PageCitationInput {
  number: number;
  text: string;
  /** Raw pdf.js items — geometry, superscript sizes. */
  items: readonly PageTextItem[];
  /** The same runs as outline items, for the pattern finder. */
  outlineItems: readonly OutlineTextItem[];
  links?: readonly import("./analysis-types.js").PdfLink[];
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

function overlapsRects(a: readonly number[], b: readonly number[]): boolean {
  const [ax0, ay0, ax1, ay1] = [Math.min(a[0]!, a[2]!), Math.min(a[1]!, a[3]!), Math.max(a[0]!, a[2]!), Math.max(a[1]!, a[3]!)];
  const [bx0, by0, bx1, by1] = [Math.min(b[0]!, b[2]!), Math.min(b[1]!, b[3]!), Math.max(b[0]!, b[2]!), Math.max(b[1]!, b[3]!)];
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

/**
 * One page's citations: what its own links name, exactly, and then what the
 * patterns find in whatever text the links leave uncovered. On a hyperref
 * PDF the first pass finds everything; on an OCR'd one the patterns are all
 * there is. A pattern mention under a URL link is dropped — the document's
 * link is what the person clicks, and painting ours over it would steal the
 * click. Every mention leaves with its rects filled in.
 */
export function matchPageCitations(
  page: PageCitationInput,
  references: readonly ParsedReference[],
  bodyFontSize: number,
  style: CitationStyle | null,
): CitationMention[] {
  const out = analyzePageLinks(
    { number: page.number, text: page.text, items: page.items },
    page.links ?? [],
    references,
  ).citations;
  const urlRects = (page.links ?? []).filter((link) => link.url).map((link) => link.rect);
  for (const mention of findCitationMentions(
    { number: page.number, text: page.text, items: page.outlineItems },
    references,
    bodyFontSize,
    style,
  )) {
    if (out.some((hit) => hit.start < mention.end && hit.end > mention.start)) continue;
    const rects = mentionRects(page.items, mention.start, mention.end);
    if (urlRects.length && rects.some((rect) => urlRects.some((url) => overlapsRects(rect, url)))) continue;
    out.push({ ...mention, rects });
  }
  for (const mention of out) {
    if (!mention.rects.length) mention.rects = mentionRects(page.items, mention.start, mention.end);
  }
  return out.sort((a, b) => a.start - b.start);
}
