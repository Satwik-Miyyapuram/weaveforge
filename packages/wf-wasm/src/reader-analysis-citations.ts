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
  findCitationCandidates,
  inReferenceList,
  matchAuthorYearText,
} from "../pkg/wf_wasm.js";

/** Citation mentions on one page that name bibliography entries, sorted by start. */
export function findPatternCitationMentions(
  page: { number: number; text: string; items: readonly AnalysisPdfItem[] },
  refs: readonly AnalysisParsedReference[],
  excluded: readonly AnalysisPageTextRange[] = [],
  candidates: readonly CitationCandidate[] = rawFindCitationCandidates(page.items),
): AnalysisCitationMention[] {
  return rawFindPatternCitationMentions(page, refs, excluded, candidates) as AnalysisCitationMention[];
}
