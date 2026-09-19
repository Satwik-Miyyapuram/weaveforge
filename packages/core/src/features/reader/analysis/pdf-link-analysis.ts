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

import type { PageTextItem } from "../../../reader/selection-to-anchor.js";
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

  // 1. Destinations are authoritative: the link names the entry.
  const resolved = linkCitationMentions({ number: page.number, items: page.items }, links, refs);
  const citations: CitationMention[] = resolved.map((mention) => {
    const [start, end] = widenToBrackets(page.text, mention.start, mention.end);
    if (start === mention.start && end === mention.end) return mention;
    return { ...mention, id: `c:${page.number}:${start}-${end}`, start, end, text: page.text.slice(start, end) };
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
      rects: [],
      referenceIndexes: [ref.index],
      source: "internal-pdf-link",
      confidence: 0.85,
    });
  }

  return { citations: citations.sort((a, b) => a.start - b.start), urlRects };
}
