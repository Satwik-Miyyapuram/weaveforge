/**
 * Internal `/Link` citation mentions (Rust `reader::link_citations`), re-exported from index.ts. Each
 * function's signature is LinkCitationsFns in packages/core/src/shared/core-contract.ts.
 * Object shapes come from ./bindings.ts.
 */
import {
  coveredTextSpans as rawCoveredTextSpans,
  linkCitationMentions as rawLinkCitationMentions,
  referenceForDestination as rawReferenceForDestination,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisCitationMention,
  AnalysisLinkDest,
  AnalysisParsedReference,
  AnalysisPdfLink,
  CoveredTextSpans,
  LinkCitationPage,
} from "./bindings.js";

export type { AnalysisPdfLink as PdfLink } from "./bindings.js";

/** The reference entry a link destination lands on, or `null`. */
export function referenceForDestination(
  dest: AnalysisLinkDest,
  refs: readonly AnalysisParsedReference[],
): AnalysisParsedReference | null {
  return rawReferenceForDestination(dest, refs) as AnalysisParsedReference | null;
}

/** The text spans a set of link boxes cover, under the page-text convention. */
export function coveredTextSpans(
  page: LinkCitationPage,
  links: readonly AnalysisPdfLink[],
): CoveredTextSpans {
  return rawCoveredTextSpans(page, links) as CoveredTextSpans;
}

/** Citation mentions from a page's internal links that resolve to a reference entry. */
export function linkCitationMentions(
  page: LinkCitationPage,
  links: readonly AnalysisPdfLink[],
  refs: readonly AnalysisParsedReference[],
): AnalysisCitationMention[] {
  return rawLinkCitationMentions(page, links, refs) as AnalysisCitationMention[];
}
