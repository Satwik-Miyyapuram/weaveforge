/**
 * Page-structure helpers (Rust `reader_analysis`: reference section, figures, running heads,
 * headings, citations), re-exported from index.ts. Each function keeps the behaviour of the
 * TypeScript function it replaced. Object shapes come from ./bindings.ts.
 */
import {
  assemblePageCitations as rawAssemblePageCitations,
  coalesceMentions as rawCoalesceMentions,
  detectCitationStyle as rawDetectCitationStyle,
  findFigureMentions as rawFindFigureMentions,
  findHeadingLines as rawFindHeadingLines,
  findReferenceSection as rawFindReferenceSection,
  furnitureLines as rawFurnitureLines,
  headingOutline as rawHeadingOutline,
  isCitationDestination as rawIsCitationDestination,
  matchPageCitations as rawMatchPageCitations,
  nativeCitationMentions as rawNativeCitationMentions,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisCitationMention,
  AnalysisPageTextRange,
  AnalysisParsedReference,
  AnalysisPdfItem,
  AnalysisPdfPage,
  AnalysisTextLine,
  CitationCandidate,
  CitationStyle,
  FigureMention,
  FigurePage,
  OutlineReaderItem,
  PageCitationInput,
  ReferenceSectionSpan,
} from "./bindings.js";

/**
 * The bibliography's span over `lines`, or `null` when there is none. `furniture` flags the lines
 * that are running heads or folios; they never count as entries.
 */
export function findReferenceSection(
  lines: readonly AnalysisTextLine[],
  bodyFontSize: number,
  pageCount: number,
  furniture?: readonly boolean[] | null,
): ReferenceSectionSpan | null {
  return rawFindReferenceSection(lines, bodyFontSize, pageCount, furniture ?? null) as
    | ReferenceSectionSpan
    | null;
}

/** Figure and table mentions across the pages. `outline` is optional. */
export function findFigureMentions(
  pages: readonly FigurePage[],
  outline?: readonly OutlineReaderItem[] | null,
): FigureMention[] {
  return rawFindFigureMentions(pages, outline ?? null) as FigureMention[];
}

/** One flag per line: `true` for running heads and folios. */
export function furnitureLines(lines: readonly AnalysisTextLine[]): boolean[] {
  return rawFurnitureLines(lines) as boolean[];
}

/** Heading lines in `lines`. `furniture` flags the lines that never count as headings. */
export function findHeadingLines(
  lines: readonly AnalysisTextLine[],
  body: number,
  furniture: readonly boolean[],
): AnalysisTextLine[] {
  const furnitureIndices = furniture.flatMap((isFurniture, index) => (isFurniture ? [index] : []));
  return rawFindHeadingLines(lines, body, furnitureIndices) as AnalysisTextLine[];
}

/** The heading lines as an outline, nested by numbering depth. */
export function headingOutline(headings: readonly AnalysisTextLine[]): OutlineReaderItem[] {
  return rawHeadingOutline(headings) as OutlineReaderItem[];
}

/** Whether the body cites by `[n]`, by `(Author year)`, or both; `undefined` for neither. */
export function detectCitationStyle(texts: readonly string[]): CitationStyle | null | undefined {
  return rawDetectCitationStyle(texts) as CitationStyle | null | undefined;
}

/** True when a PDF named destination is a citation target (a bibliography or reference anchor). */
export function isCitationDestination(name: string | null | undefined): boolean {
  return rawIsCitationDestination(name ?? null);
}

/** Citation mentions taken from the page's internal links. */
export function nativeCitationMentions(
  page: AnalysisPdfPage,
  refs: readonly AnalysisParsedReference[],
  excluded: readonly AnalysisPageTextRange[],
): AnalysisCitationMention[] {
  return rawNativeCitationMentions(page, refs, excluded) as AnalysisCitationMention[];
}

/** Merges adjacent citation mentions that belong to one citation. */
export function coalesceMentions(
  mentions: readonly AnalysisCitationMention[],
  text: string,
  items: readonly AnalysisPdfItem[],
): AnalysisCitationMention[] {
  return rawCoalesceMentions(mentions, text, items) as AnalysisCitationMention[];
}

/** One page's citations: native link mentions, pattern mentions and text candidates, assembled. */
export function assemblePageCitations(
  page: AnalysisPdfPage,
  native: readonly AnalysisCitationMention[],
  patterns: readonly AnalysisCitationMention[],
  excluded: readonly AnalysisPageTextRange[],
  candidates?: readonly CitationCandidate[] | null,
): AnalysisCitationMention[] {
  return rawAssemblePageCitations(page, native, patterns, excluded, candidates ?? null) as AnalysisCitationMention[];
}

/** Matches one page's citations against the parsed references and maps them to PDF rectangles. */
export function matchPageCitations(
  page: PageCitationInput,
  references: readonly AnalysisParsedReference[],
  referenceRanges: readonly AnalysisPageTextRange[],
): AnalysisCitationMention[] {
  return rawMatchPageCitations(page, references, referenceRanges) as AnalysisCitationMention[];
}
