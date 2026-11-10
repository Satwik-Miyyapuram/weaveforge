/**
 * Open-access lookup (Rust `papers::open_access`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts. Fetching the indexes stays in TypeScript.
 */
import {
  cleanArxivId as rawCleanArxivId,
  cleanPmcid as rawCleanPmcid,
  resolveArxivId as rawResolveArxivId,
  knownCandidates as rawKnownCandidates,
  arxivCandidates as rawArxivCandidates,
  pmcCandidates as rawPmcCandidates,
  parseOpenalex as rawParseOpenalex,
  parseUnpaywall as rawParseUnpaywall,
  parseSemanticScholar as rawParseSemanticScholar,
  parseEuropePmc as rawParseEuropePmc,
  parseBiorxiv as rawParseBiorxiv,
  parseDoaj as rawParseDoaj,
  parseZenodo as rawParseZenodo,
  parseHal as rawParseHal,
  rankOpenAccessCandidates as rawRankOpenAccessCandidates,
  preprintServerFor as rawPreprintServerFor,
  zenodoRecordId as rawZenodoRecordId,
} from "../pkg/wf_wasm.js";
import type { EuropePmcAnswer, OpenAccessCandidate } from "./bindings.js";

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

/** arXiv's PDF and HTML copies. */
export function arxivCandidates(arxivId: string): OpenAccessCandidate[] {
  return rawArxivCandidates(arxivId) as OpenAccessCandidate[];
}

/** PubMed Central's PDF and HTML copies. */
export function pmcCandidates(pmcid: string, license?: string): OpenAccessCandidate[] {
  return rawPmcCandidates(pmcid, license) as OpenAccessCandidate[];
}

/** OpenAlex's answer as candidates. */
export function parseOpenalex(body: unknown): OpenAccessCandidate[] {
  return rawParseOpenalex(body) as OpenAccessCandidate[];
}

/** Unpaywall's answer as candidates. */
export function parseUnpaywall(body: unknown): OpenAccessCandidate[] {
  return rawParseUnpaywall(body) as OpenAccessCandidate[];
}

/** Semantic Scholar's answer as candidates. */
export function parseSemanticScholar(body: unknown): OpenAccessCandidate[] {
  return rawParseSemanticScholar(body) as OpenAccessCandidate[];
}

/** Europe PMC's answer as candidates and the PMCID it names. */
export function parseEuropePmc(body: unknown): EuropePmcAnswer {
  return rawParseEuropePmc(body) as EuropePmcAnswer;
}

/** A bioRxiv or medRxiv answer as candidates. */
export function parseBiorxiv(body: unknown, server: string): OpenAccessCandidate[] {
  return rawParseBiorxiv(body, server) as OpenAccessCandidate[];
}

/** DOAJ's answer as candidates. */
export function parseDoaj(body: unknown): OpenAccessCandidate[] {
  return rawParseDoaj(body) as OpenAccessCandidate[];
}

/** A Zenodo record's answer as candidates. */
export function parseZenodo(body: unknown): OpenAccessCandidate[] {
  return rawParseZenodo(body) as OpenAccessCandidate[];
}

/** The preprint server that owns a DOI (`"biorxiv"`), or `undefined`. */
export function preprintServerFor(doi: string): string | undefined {
  return rawPreprintServerFor(doi);
}

/** The Zenodo record id in a `10.5281/zenodo.<id>` DOI, or `undefined`. */
export function zenodoRecordId(doi: string): string | undefined {
  return rawZenodoRecordId(doi);
}

/** HAL's answer as candidates. */
export function parseHal(body: unknown): OpenAccessCandidate[] {
  return rawParseHal(body) as OpenAccessCandidate[];
}

/** Deduplicated candidates, PDFs first, then source order. */
export function rankOpenAccessCandidates(candidates: readonly OpenAccessCandidate[]): OpenAccessCandidate[] {
  return rawRankOpenAccessCandidates(candidates) as OpenAccessCandidate[];
}
