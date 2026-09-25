/**
 * The document's own `/Link` annotations, read as citations.
 *
 * A LaTeX PDF carries a real internal link over every hyperref/natbib
 * citation, and that link is treated as authoritative before any regex
 * parsing: the destination names the entry (resolved by position in the
 * list), and where the destination does not answer — a named `/Dest` the
 * list cannot place — the link's printed text is still read against the
 * entries' labels. URL links are the document's own; they are collected so
 * no mention of ours is ever painted over one.
 */

import { itemToRect, type PageTextItem } from "../../../reader/selection-to-anchor.js";
import { coveredTextSpans, linkCitationMentions } from "../link-citations.js";
import type { CitationMention, ParsedReference, PdfLink } from "./analysis-types.js";

/**
 * Widen a link's span to the brackets around it, so a link that hyperref
 * drew over the `16` of `[16]` — and a `5` of `[5, 2, 35]` — is painted
 * with its punctuation and reads as the printed citation. Brackets are only
 * taken when they belong to this span, not to a neighbour.
 */
export function widenToBrackets(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s > 0 && /\s/.test(text[s - 1]!)) s--;
  while (e < text.length && /\s/.test(text[e]!)) e++;
  if (text[s - 1] === "[" && text[e] === "]") return [s - 1, e + 1];
  return [start, end];
}

/** The label number printed under a link: `12`, `[12]`, `12.` all give 12. */
function labelOf(text: string): number | null {
  const match = /^[\[(]?(\d{1,3})[\])]?\.?$/.exec(text.trim());
  return match ? Number(match[1]) : null;
}

/**
 * A mention's geometry, from the text it covers and nothing else.
 *
 * Built *before* the span is widened back to its brackets, and for a link
 * inside a group — hyperref draws one box per number, so `[3, 4, 5]` is three
 * links — from that link's own number only. Widening first and then measuring
 * gave every number in the group the whole group's box, so the underline for
 * `[3]` was drawn across `[3, 4, 5]`, displaced from the bracket it named.
 */
function rectsOf(
  items: readonly PageTextItem[],
  start: number,
  end: number,
): [number, number, number, number][] {
  const rects: [number, number, number, number][] = [];
  let cursor = 0;
  for (const item of items) {
    const itemStart = cursor;
    const itemEnd = cursor + item.str.length;
    cursor = itemEnd + (item.hasEOL ? 1 : 0);
    if (itemEnd <= start || itemStart >= end) continue;
    const rect = itemToRect(item, Math.max(0, start - itemStart), Math.min(item.str.length, end - itemStart));
    if (!rect || rect[2]! <= rect[0]! || rect[3]! <= rect[1]!) continue;
    // Clamped to the item's own box. `itemToRect` interpolates across the item's
    // width from pdf.js's reported `width`, and on a page where the text layer
    // under-reports it — a justified line of one giant item — the interpolated
    // rect came back a whole page wide while the characters under this span sat
    // in a few glyphs of it. That is what drew one mention's underline across
    // the full width of page 1 instead of under its two citations.
    const box = itemToRect(item);
    rects.push([
      Math.max(rect[0]!, box?.[0] ?? rect[0]!),
      Math.max(rect[1]!, box?.[1] ?? rect[1]!),
      Math.min(rect[2]!, box?.[2] ?? rect[2]!),
      Math.min(rect[3]!, box?.[3] ?? rect[3]!),
    ]);
  }
  return rects.filter((rect) => rect[2]! > rect[0]! && rect[3]! > rect[1]!);
}

export interface PageLinkAnalysis {
  /** Internal-link citations, widened to their brackets, in reading order. */
  citations: CitationMention[];
  /** Boxes of the page's URL links, which no mention may cover. */
  urlRects: [number, number, number, number][];
}

/**
 * Citation mentions a page's links give. Destinations resolve first; a link
 * whose destination the list cannot answer falls back to matching its
 * covered text against the entries' labels — hyperref's box is still over
 * the citation, and a printed `[12]` under it is not ambiguous. All spans
 * are widened to their brackets before they leave.
 */
export function analyzePageLinks(
  page: { number: number; text: string; items: readonly PageTextItem[] },
  links: readonly PdfLink[],
  refs: readonly ParsedReference[],
): PageLinkAnalysis {
  const urlRects = links.filter((link) => link.url).map((link) => link.rect);
  const internal = links.filter((link) => link.dest && !link.url);
  if (!internal.length || !refs.length) return { citations: [], urlRects };

  // 1. Destinations are authoritative: the link names the entry. The mention
  // keeps the geometry of the number the link actually covered; only its text
  // span is widened, so the label reads as the printed `[16]`.
  const resolved = linkCitationMentions({ number: page.number, items: page.items }, links, refs);
  const citations: CitationMention[] = resolved.map((mention) => {
    const [start, end] = widenToBrackets(page.text, mention.start, mention.end);
    return {
      ...mention,
      id: `c:${page.number}:${start}-${end}`,
      start,
      end,
      text: page.text.slice(start, end),
      rects: mention.rects.length ? mention.rects : rectsOf(page.items, mention.start, mention.end),
    };
  });

  // 2. Native link text/geometry: internal links the destinations did not
  // resolve, matched by their printed label instead.
  const { spans, text } = coveredTextSpans({ number: page.number, items: page.items }, internal);
  const byLabel = new Map<number, ParsedReference>();
  for (const ref of refs) {
    const num = ref.label ? Number(ref.label.replace(/\D+/g, "")) : ref.index;
    if (Number.isFinite(num) && num > 0 && !byLabel.has(num)) byLabel.set(num, ref);
  }
  for (const { start, end } of spans) {
    if (citations.some((m) => start < m.end && end > m.start)) continue;
    const num = labelOf(text.slice(start, end));
    const ref = num != null ? byLabel.get(num) : undefined;
    if (!ref) continue;
    const [ws, we] = widenToBrackets(text, start, end);
    citations.push({
      id: `c:${page.number}:${ws}-${we}`,
      page: page.number,
      start: ws,
      end: we,
      text: text.slice(ws, we),
      // This link's own covered span, not the widened one: the underline is
      // under the number, and the brackets only shape the label.
      rects: rectsOf(page.items, start, end),
      referenceIndexes: [ref.index],
      source: "internal-pdf-link",
      confidence: 0.85,
    });
  }

  return { citations: citations.sort((a, b) => a.start - b.start), urlRects };
}
