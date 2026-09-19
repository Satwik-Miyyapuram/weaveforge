import { itemToRect, type PageTextItem } from "../../reader/selection-to-anchor.js";
import type { CitationMention, ParsedReference, PdfLink } from "./analysis/analysis-types.js";

export type { PdfLink };

/**
 * The reference entry a link destination lands on: the entry on that page
 * whose first line starts at or just below the destination point. `/XYZ`
 * destinations from hyperref sit a little above the entry's baseline, so the
 * nearest entry *below* the point (with a small tolerance) is the one meant;
 * in two-column layouts the same `y` occurs in both columns, so an entry in
 * the destination's column wins over one in the other.
 */
export function referenceForDestination(
  dest: { page: number; x?: number; y?: number },
  refs: readonly ParsedReference[],
): ParsedReference | null {
  const onPage = refs.filter((ref) => ref.page === dest.page);
  if (!onPage.length) return null;
  if (dest.y === undefined) return onPage[0]!;
  const y = dest.y;
  const sameColumn =
    dest.x === undefined ? onPage : onPage.filter((ref) => Math.abs(ref.x - dest.x!) <= 40);
  const pick = (pool: readonly ParsedReference[]) => {
    let best: ParsedReference | null = null;
    for (const ref of pool) {
      if (ref.y > y + 2) continue;
      if (!best || ref.y > best.y) best = ref;
    }
    return best;
  };
  return pick(sameColumn) ?? pick(onPage);
}

/** Horizontal overlap of two `[x1, y1, x2, y2]` boxes, in points. */
function overlapX(a: readonly number[], b: readonly number[]): number {
  return Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!);
}

function overlapY(a: readonly number[], b: readonly number[]): number {
  return Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!);
}

export interface CoveredTextSpan {
  link: PdfLink;
  /** Offsets into the page-text convention string, trimmed of separators. */
  start: number;
  end: number;
}

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
export function coveredTextSpans(
  page: { number: number; items: readonly PageTextItem[] },
  links: readonly PdfLink[],
): { spans: CoveredTextSpan[]; text: string } {
  const rows: { start: number; end: number; rect: number[]; item: PageTextItem }[] = [];
  let text = "";
  for (const item of page.items) {
    const start = text.length;
    text += item.str + (item.hasEOL ? "\n" : "");
    const rect = itemToRect(item);
    if (rect && item.str.trim()) rows.push({ start, end: start + item.str.length, rect, item });
  }
  const spans: CoveredTextSpan[] = [];
  for (const link of links) {
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (const row of rows) {
      const h = row.rect[3]! - row.rect[1]!;
      if (overlapY(link.rect, row.rect) < Math.min(h, link.rect[3] - link.rect[1]) * 0.4) continue;
      const w = row.rect[2]! - row.rect[0]!;
      const len = row.item.str.length;
      // A box that grazes the edge of a neighbouring item by less than half a
      // glyph is not over it; hyperref's boxes stop a hair past the digits.
      if (overlapX(link.rect, row.rect) < Math.min(2, (w / len) * 0.5)) continue;
      // Which characters of this item the box covers, by proportion, each
      // edge snapped to the nearest glyph boundary. Glyphs are not all one
      // width, so the span is trimmed below rather than trusted.
      const from = w > 0 ? Math.max(0, Math.round(((link.rect[0] - row.rect[0]!) / w) * len)) : 0;
      const to = w > 0 ? Math.min(len, Math.round(((link.rect[2] - row.rect[0]!) / w) * len)) : len;
      if (to <= from) continue;
      start = Math.min(start, row.start + from);
      end = Math.max(end, row.start + to);
    }
    while (start < end && /[\s,;[()\]]/.test(text[start]!)) start++;
    while (end > start && /[\s,;[()\]]/.test(text[end - 1]!)) end--;
    if (end > start) spans.push({ link, start, end });
  }
  return { spans, text };
}

/**
 * Citation mentions from a page's links: for each internal link that resolves
 * to an entry, the span of page text under its box. The document's own links
 * are authoritative — a LaTeX PDF has a real `/Link` over `[16]`, and that is
 * trusted before any regex parsing. Links that cover no text (an empty box, a
 * figure) give nothing; each mention carries its source and full confidence.
 */
export function linkCitationMentions(
  page: { number: number; items: readonly PageTextItem[] },
  links: readonly PdfLink[],
  refs: readonly ParsedReference[],
): CitationMention[] {
  const citing = links.filter((link) => link.dest && !link.url);
  if (!citing.length) return [];
  const { spans, text } = coveredTextSpans(page, citing);
  const out: CitationMention[] = [];
  for (const { link, start, end } of spans) {
    const ref = referenceForDestination(link.dest!, refs);
    if (!ref) continue;
    if (!out.some((m) => start < m.end && end > m.start)) {
      out.push({
        id: `c:${page.number}:${start}-${end}`,
        page: page.number,
        start,
        end,
        text: text.slice(start, end),
        rects: [],
        referenceIndexes: [ref.index],
        source: "internal-pdf-link",
        confidence: 1,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
