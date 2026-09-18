import { itemToRect, type PageTextItem } from "../../reader/selection-to-anchor.js";
import type { CitationMention } from "./find-citation-mentions.js";
import type { ParsedReference } from "./parse-reference-list.js";

/**
 * A `/Link` annotation as the reader sees it: the box it covers on the page
 * (PDF user space, `[x1, y1, x2, y2]`) and where it goes — a URL, or a place
 * in this document. LaTeX (hyperref, natbib) writes one of these over every
 * citation, pointing at the entry in the reference list; that is the signal
 * the Google Scholar reader uses before it looks at any text, and the reason
 * its links land on `[16]` when a regex over `[16 ]` does not.
 */
export interface PdfLink {
  rect: [number, number, number, number];
  url?: string;
  /** 1-based page and the point the destination names, if it names one. */
  dest?: { page: number; x?: number; y?: number };
}

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

/**
 * Citation mentions from a page's links: for each link that resolves to an
 * entry, the span of page text under its box. Offsets follow the reader's
 * page-text convention — items concatenated, a newline after each `hasEOL`
 * item — so they line up with what `findCitationMentions` produces and with
 * the overlay that draws them.
 *
 * A text item under the box contributes the part of itself the box covers,
 * proportionally by character; a link that covers the `16` of `[16]` gives
 * `16`, and the caller widens to the brackets if it wants them. Links that
 * cover no text (an empty box, a figure) give nothing. Adjacent links in one
 * bracket (`[5, 2, 35]` is three links) stay separate mentions, each with its
 * own entry, which is what the popover wants.
 */
export function linkCitationMentions(
  page: { number: number; items: readonly PageTextItem[] },
  links: readonly PdfLink[],
  refs: readonly ParsedReference[],
): CitationMention[] {
  const out: CitationMention[] = [];
  const citing = links.filter((link) => link.dest && !link.url);
  if (!citing.length) return out;
  // Offsets and boxes for every item, once.
  const rows: { start: number; end: number; rect: number[]; item: PageTextItem }[] = [];
  let offset = 0;
  for (const item of page.items) {
    const start = offset;
    offset += item.str.length + (item.hasEOL ? 1 : 0);
    const rect = itemToRect(item);
    if (rect && item.str.trim()) rows.push({ start, end: start + item.str.length, rect, item });
  }
  for (const link of citing) {
    const ref = referenceForDestination(link.dest!, refs);
    if (!ref) continue;
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
      // Which characters of this item the box covers, by proportion.
      const from = w > 0 ? Math.max(0, Math.floor(((link.rect[0] - row.rect[0]!) / w) * len)) : 0;
      const to = w > 0 ? Math.min(len, Math.ceil(((link.rect[2] - row.rect[0]!) / w) * len)) : len;
      if (to <= from) continue;
      start = Math.min(start, row.start + from);
      end = Math.max(end, row.start + to);
    }
    if (end <= start) continue;
    if (!out.some((m) => start < m.end && end > m.start)) {
      out.push({ page: page.number, start, end, refIndexes: [ref.index] });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
