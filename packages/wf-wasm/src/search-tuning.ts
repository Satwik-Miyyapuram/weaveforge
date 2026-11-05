/**
 * Search ranking rules (Rust `search_tuning`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/search-tuning.ts.
 */
import {
  documentBoost as rawDocumentBoost,
  fuzzinessForTerm as rawFuzzinessForTerm,
} from "../pkg/wf_wasm.js";
import type { DocumentBoostOptions, SearchField } from "./bindings.js";

export type { SearchField } from "./bindings.js";

export const FIELD_BOOSTS = {
  title: 8,
  aliases: 6,
  headings: 3,
  tags: 3,
  path: 2,
  body: 1,
} as const;

export const SEARCH_FIELDS: SearchField[] = ["title", "aliases", "headings", "tags", "path", "body"];

/** Terms shorter than this are matched exactly; prefix matching needs length. */
export const MIN_PREFIX_LENGTH = 3;

/** Cap on indexed body length. Beyond this a document is noise in every query. */
export const MAX_INDEXED_BODY_CHARS = 256_000;

/** Corpus size past which the client index is likely to strain. */
export const LARGE_CORPUS_WARNING = 5_000;

/**
 * Edit distance as a fraction of term length, graduated by length.
 */
export function fuzzinessForTerm(term: string): number {
  return rawFuzzinessForTerm(term);
}

/**
 * Document-level multiplier, applied on top of field scoring. `options.now`
 * defaults to the current time and is resolved here, not in Rust.
 */
export function documentBoost(
  doc: { degree: number; updatedAt: string },
  options: DocumentBoostOptions & { now?: number } = {},
): number {
  const now = options.now ?? Date.now();
  return rawDocumentBoost(doc, options, now);
}
