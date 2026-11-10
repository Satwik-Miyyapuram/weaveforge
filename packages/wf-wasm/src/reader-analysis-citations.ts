/**
 * Citation candidates and pattern mentions (Rust `reader_analysis::citations`), re-exported from index.ts. Each
 * function keeps the signature and defaults of
 * CitationsFns in packages/core/src/shared/core-contract.ts. Object shapes come from ./bindings.ts.
 */
import {
  findCitationCandidates as rawFindCitationCandidates,
  findPatternCitationMentions as rawFindPatternCitationMentions,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisCitationMention,
  AnalysisPageTextRange,
  AnalysisParsedReference,
  AnalysisPdfItem,
  CitationCandidate,
} from "./bindings.js";

export {
  inReferenceList,
  matchAuthorYearText,
} from "../pkg/wf_wasm.js";

/** Numeric and author-year citation candidates in the page items, sorted by start. */
export function findCitationCandidates(items: readonly AnalysisPdfItem[]): CitationCandidate[] {
  return rawFindCitationCandidates(items) as CitationCandidate[];
}

/** Citation mentions on one page that name bibliography entries, sorted by start. */
export function findPatternCitationMentions(
  page: { number: number; text: string; items: readonly AnalysisPdfItem[] },
  refs: readonly AnalysisParsedReference[],
  excluded: readonly AnalysisPageTextRange[] = [],
  candidates: readonly CitationCandidate[] = findCitationCandidates(page.items),
): AnalysisCitationMention[] {
  return rawFindPatternCitationMentions(page, refs, excluded, candidates) as AnalysisCitationMention[];
}
