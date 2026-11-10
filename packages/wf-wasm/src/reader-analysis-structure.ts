/**
 * Page-structure helpers (Rust `reader_analysis`: reference section, figures, running heads,
 * headings, citations), re-exported from index.ts. Each function keeps the behaviour of the
 * TypeScript function it replaced. Object shapes come from ./bindings.ts.
 */
import {
  assemblePageCitations as rawAssemblePageCitations,
  findFigureMentions as rawFindFigureMentions,
  findHeadingLines as rawFindHeadingLines,
  findReferenceSection as rawFindReferenceSection,
  isCitationDestination as rawIsCitationDestination,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisCitationMention,
  AnalysisPageTextRange,
  AnalysisPdfPage,
  AnalysisTextLine,
  CitationCandidate,
  FigureMention,
  FigurePage,
  OutlineReaderItem,
  ReferenceSectionSpan,
} from "./bindings.js";

export {
  coalesceMentions,
  detectCitationStyle,
  furnitureLines,
  headingOutline,
  matchPageCitations,
  nativeCitationMentions,
} from "../pkg/wf_wasm.js";

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

/** Heading lines in `lines`. `furniture` flags the lines that never count as headings. */
export function findHeadingLines(
  lines: readonly AnalysisTextLine[],
  body: number,
  furniture: readonly boolean[],
): AnalysisTextLine[] {
  const furnitureIndices = furniture.flatMap((isFurniture, index) => (isFurniture ? [index] : []));
  return rawFindHeadingLines(lines, body, furnitureIndices) as AnalysisTextLine[];
}

/** True when a PDF named destination is a citation target (a bibliography or reference anchor). */
export function isCitationDestination(name: string | null | undefined): boolean {
  return rawIsCitationDestination(name ?? null);
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

