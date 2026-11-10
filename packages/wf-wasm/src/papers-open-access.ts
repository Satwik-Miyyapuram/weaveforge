/**
 * Open-access lookup (Rust `papers::open_access`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts. Fetching the indexes stays in TypeScript.
 */
import {
  cleanArxivId as rawCleanArxivId,
  cleanPmcid as rawCleanPmcid,
  resolveArxivId as rawResolveArxivId,
  knownCandidates as rawKnownCandidates,
  pmcCandidates as rawPmcCandidates,
  rankOpenAccessCandidates as rawRankOpenAccessCandidates,
} from "../pkg/wf_wasm.js";
import type {
  EuropePmcAnswer,
  OpenAccessCandidate,
} from "./bindings.js";

export {
  arxivCandidates,
  parseBiorxiv,
  parseDoaj,
  parseEuropePmc,
  parseHal,
  parseOpenalex,
  parseSemanticScholar,
  parseUnpaywall,
  parseZenodo,
  preprintServerFor,
  zenodoRecordId,
} from "../pkg/wf_wasm.js";

export type {
  EuropePmcAnswer,
  OpenAccessCandidate,
  OpenAccessFormat,
  OpenAccessSource,
} from "./bindings.js";

/** The arXiv id in a cleaned form, or undefined. */
export function cleanArxivId(id: string | null | undefined): string | undefined {
  return rawCleanArxivId(id ?? undefined) ?? undefined;
}

/** The PMCID in a cleaned form, or undefined. */
export function cleanPmcid(id: string | null | undefined): string | undefined {
  return rawCleanPmcid(id ?? undefined) ?? undefined;
}

/** The arXiv id to ask about, from the arXiv id or the DOI. */
export function resolveArxivId(arxivId: string | null | undefined, doi: string | null | undefined): string | undefined {
  return rawResolveArxivId(arxivId ?? undefined, doi ?? undefined) ?? undefined;
}

/** The paper's own PDF and page, when known. */
export function knownCandidates(knownPdf: string | null | undefined, page: string | null | undefined): OpenAccessCandidate[] {
  return rawKnownCandidates(knownPdf ?? undefined, page ?? undefined) as OpenAccessCandidate[];
}

/** PubMed Central's PDF and HTML copies. */
export function pmcCandidates(pmcid: string, license?: string): OpenAccessCandidate[] {
  return rawPmcCandidates(pmcid, license) as OpenAccessCandidate[];
}

/** Deduplicated candidates, PDFs first, then source order. */
export function rankOpenAccessCandidates(candidates: readonly OpenAccessCandidate[]): OpenAccessCandidate[] {
  return rawRankOpenAccessCandidates(candidates) as OpenAccessCandidate[];
}
