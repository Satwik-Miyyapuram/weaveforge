/**
 * Open-access lookup (Rust `papers::open_access`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts. Fetching the indexes stays in TypeScript.
 */
import {
  cleanArxivId as rawCleanArxivId,
  cleanPmcid as rawCleanPmcid,
  resolveArxivId as rawResolveArxivId,
} from "../pkg/wf_wasm.js";

export {
  rankOpenAccessCandidates,
} from "../pkg/wf_wasm.js";

export {
  arxivCandidates,
  knownCandidates,
  parseBiorxiv,
  parseDoaj,
  parseEuropePmc,
  parseHal,
  parseOpenalex,
  parseSemanticScholar,
  parseUnpaywall,
  parseZenodo,
  pmcCandidates,
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

