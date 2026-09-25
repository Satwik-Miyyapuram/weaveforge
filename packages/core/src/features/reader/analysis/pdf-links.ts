/**
 * The document's own `/Link` annotations read as citation mentions, ported
 * from the reference Scholar reader (`pdf-links.ts`). These are *support*
 * for the text candidates in `citation-assembly`, not mentions on their own:
 * an author-year citation hyperref split into an author link and a year link
 * gives two of these, and assembly folds them back into the one printed span.
 */
import type { AnalyzePdfPage, CitationMention, PageTextRange, ParsedReference, PdfLink } from "./analysis-types.js";
import { mentionRects, pageTextFromItems } from "./citation-text.js";
import { inReferenceList, matchAuthorYearText } from "./citations.js";

export function isCitationDestination(name: string | undefined): boolean {
  return /^(?:cite(?:[.:/_-]|$)|bib(?:item)?[.:/_-]|bib\d)/i.test(name ?? "");
}

function referenceAtDestination(dest: PdfLink["dest"], refs: readonly ParsedReference[]): ParsedReference | undefined {
  if (!dest || dest.y === undefined) return undefined;
  const candidates = refs.filter((ref) => ref.page === dest.page && dest.y! - ref.y >= -4 && dest.y! - ref.y <= 32);
  const sameColumn = dest.x == null ? candidates : candidates.filter((ref) => Math.abs(ref.x - dest.x!) < 70);
  return (sameColumn.length ? sameColumn : candidates).sort((a, b) => Math.abs(dest.y! - a.y) - Math.abs(dest.y! - b.y))[0];
}

export function nativeCitationMentions(page: AnalyzePdfPage, refs: readonly ParsedReference[], excluded: readonly PageTextRange[]): CitationMention[] {
  const text = pageTextFromItems(page.items);
  const mentions: CitationMention[] = [];
  (page.links ?? []).forEach((link, i) => {
    if (link.url || (!link.dest && !link.destName)) return;
    const namedCitation = isCitationDestination(link.destName);
    if (link.destName && /^(?:section|subsection|figure|table|equation|page|h?footnote|theorem|appendix)[.:/_\d-]/i.test(link.destName)) return;
    const ranges = (link.textRanges ?? []).filter((range) => Number.isInteger(range.start) &&
      Number.isInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= text.length);
    let start = ranges.length ? Math.min(...ranges.map((range) => range.start)) : 0;
    let end = ranges.length ? Math.max(...ranges.map((range) => range.end)) : 0;
    while (start < end && /[\s​-‍⁠]/.test(text[start]!)) start++;
    while (end > start && /[\s​-‍⁠]/.test(text[end - 1]!)) end--;
    if (inReferenceList(page.pageNumber, start, end, excluded)) return;
    const printed = text.slice(start, end);
    const positioned = referenceAtDestination(link.dest, refs);
    const printedRefs = matchAuthorYearText(printed, refs);
    const numeric = /^\[?\s*(\d{1,3})\s*\]?$/.exec(printed);
    const numericRef = numeric ? refs.find((ref) => ref.label && ref.index === Number(numeric[1])) : undefined;
    const indexes = positioned ? [positioned.index] : printedRefs.length ? printedRefs : numericRef ? [numericRef.index] : [];
    if (!namedCitation && !printedRefs.length && !numericRef) return;
    // Unmeasured named annotations may corroborate a parsed citation, but cannot
    // directly link an invented substring or an entire overlapping glyph run.
    mentions.push({
      id: `link:${page.pageNumber}:${i}`, page: page.pageNumber, start, end,
      text: printed, rects: mentionRects(page.items, start, end), nativeRects: [link.rect],
      referenceIndexes: indexes, source: "internal-pdf-link", confidence: namedCitation ? 1 : 0.85,
      target: link.dest, destinationName: link.destName, spanSource: "annotation",
    });
  });
  return mentions;
}
