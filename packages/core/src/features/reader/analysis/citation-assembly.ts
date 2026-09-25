/**
 * One page's citations, ported from the reference Scholar reader
 * (`citation-assembly.ts`). The text candidates are the mentions; the
 * document's own links only support them, so `Kingma & Welling (2014)` set
 * as two hyperref boxes is one citation, not two. Native links no candidate
 * claims are kept and coalesced with their neighbours.
 */
import type { AnalyzePdfPage, CitationMention, PageTextRange } from "./analysis-types.js";
import { findCitationCandidates, inReferenceList } from "./citations.js";
import { mentionRects, pageTextFromItems, rectanglesOverlap, stripInvisible, type PdfItem } from "./citation-text.js";

function sameReference(a: CitationMention, b: CitationMention): boolean {
  if (a.page !== b.page) return false;
  if (a.destinationName && b.destinationName) return a.destinationName === b.destinationName;
  if (a.target && b.target && a.target.x != null && b.target.x != null && a.target.y != null && b.target.y != null) {
    return a.target.page === b.target.page && Math.abs(a.target.x - b.target.x) < 1 && Math.abs(a.target.y - b.target.y) < 1;
  }
  return a.referenceIndexes.length > 0 && a.referenceIndexes.length === b.referenceIndexes.length &&
    a.referenceIndexes.every((index) => b.referenceIndexes.includes(index));
}

export function coalesceMentions(mentions: readonly CitationMention[], text: string, items: readonly PdfItem[]): CitationMention[] {
  const out: CitationMention[] = [];
  for (const original of [...mentions].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const mention = { ...original, rects: original.rects.map((rect) => [...rect]), referenceIndexes: [...original.referenceIndexes] };
    if (mention.end <= mention.start) continue;
    const previous = out[out.length - 1];
    if (previous && sameReference(previous, mention)) {
      const overlapping = mention.start < previous.end;
      const gap = stripInvisible(text.slice(previous.end, mention.start));
      const yearOnly = /^[\s,\(\[]*(?:19|20)\d{2}[a-z]?[\s\)\].]*$/.test(mention.text);
      const authorOnly = /\p{L}/u.test(previous.text) && !/\b(?:19|20)\d{2}/.test(previous.text);
      const complementary = previous.spanSource !== "text" && mention.spanSource !== "text" &&
        authorOnly && yearOnly && gap.length < 24 && /^[\s,(]*$/.test(gap);
      if (overlapping || complementary) {
        // A verified text span owns its boundaries. Annotation estimates cannot expand it.
        if (previous.spanSource === "text") continue;
        if (mention.spanSource === "text") { out[out.length - 1] = mention; continue; }
        previous.end = Math.max(previous.end, mention.end);
        previous.text = text.slice(previous.start, previous.end);
        const rects = mentionRects(items, previous.start, previous.end);
        previous.rects = rects.length ? rects : [...previous.rects, ...mention.rects];
        previous.nativeRects = [...(previous.nativeRects ?? []), ...(mention.nativeRects ?? [])];
        previous.target ??= mention.target;
        previous.destinationName ??= mention.destinationName;
        continue;
      }
    }
    out.push(mention);
  }
  return out;
}

function intersectsMention(candidate: { start: number; end: number }, hit: CitationMention): boolean {
  return candidate.start < hit.end && candidate.end > hit.start;
}

export function assemblePageCitations(
  page: AnalyzePdfPage,
  native: readonly CitationMention[],
  patterns: readonly CitationMention[],
  excluded: readonly PageTextRange[],
): CitationMention[] {
  const text = pageTextFromItems(page.items);
  const used = new Set<string>();
  const result: CitationMention[] = [];
  const urls = (page.links ?? []).filter((link) => link.url).map((link) => link.rect);
  for (const candidate of findCitationCandidates(page.items)) {
    if (inReferenceList(page.pageNumber, candidate.start, candidate.end, excluded)) continue;
    const rects = mentionRects(page.items, candidate.start, candidate.end);
    if (rects.some((rect) => urls.some((url) => rectanglesOverlap(rect, url)))) continue;
    const supporting = native.filter((hit) => {
      if (used.has(hit.id)) return false;
      if (hit.end > hit.start) return intersectsMention(candidate, hit);
      return (hit.nativeRects ?? []).some((box) => rects.some((rect) => rectanglesOverlap(box, rect)));
    });
    const pattern = patterns.find((hit) => hit.start === candidate.start && hit.end === candidate.end);
    if (!supporting.length && !pattern) continue;
    // Conflicting native targets must not be flattened into a single author-year link.
    const distinctTargets = new Set(supporting.map((hit) => hit.destinationName ?? JSON.stringify(hit.target ?? hit.referenceIndexes)));
    if (candidate.source === "author-year" && distinctTargets.size > 1 && !pattern) continue;
    supporting.forEach((hit) => used.add(hit.id));
    const indexes = pattern?.referenceIndexes.length ? pattern.referenceIndexes
      : [...new Set(supporting.flatMap((hit) => hit.referenceIndexes))];
    result.push({
      id: `citation:${page.pageNumber}:${candidate.start}:${candidate.end}`,
      page: page.pageNumber,
      start: candidate.start, end: candidate.end, text: candidate.text,
      rects, referenceIndexes: indexes,
      source: supporting.length ? "internal-pdf-link" : candidate.source,
      confidence: supporting.length ? 1 : pattern!.confidence,
      spanSource: "text",
      target: supporting[0]?.target,
      destinationName: supporting[0]?.destinationName,
      nativeRects: supporting.flatMap((hit) => hit.nativeRects ?? []),
    });
  }
  const remaining = native.filter((hit) => !used.has(hit.id) && hit.end > hit.start &&
    !result.some((matched) => intersectsMention(hit, matched)));
  return coalesceMentions([...result, ...remaining], text, page.items);
}
