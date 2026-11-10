/**
 * Related-paper hit mappers (Rust `related_paper_hit`), re-exported from index.ts.
 * Keeps the results of the helpers in
 * apps/web/src/features/papers/application/fetch-related-papers.ts.
 */
import {
  collectNewHits as rawCollectNewHits,
  invertedAbstract as rawInvertedAbstract,
  localKeys as rawLocalKeys,
  openAlexToHit as rawOpenAlexToHit,
  s2NestedFields as rawS2NestedFields,
  s2ToHit as rawS2ToHit,
  seedDoi as rawSeedDoi,
  sortByCitations as rawSortByCitations,
} from "../pkg/wf_wasm.js";
import type { RelatedPaperCollectOutput, RelatedPaperHitRow, RelatedPaperKeys } from "./bindings.js";

export type { RelatedPaperCollectOutput, RelatedPaperHitRow, RelatedPaperKeys } from "./bindings.js";

/** The hit for a Semantic Scholar paper, or null when it has no title. */
export function s2ToHit(paper: unknown): RelatedPaperHitRow | null {
  return (rawS2ToHit(paper) as RelatedPaperHitRow | undefined) ?? null;
}

/** The hit for an OpenAlex work, or null when it has no title. */
export function openAlexToHit(work: unknown): RelatedPaperHitRow | null {
  return (rawOpenAlexToHit(work) as RelatedPaperHitRow | undefined) ?? null;
}

/** The abstract text rebuilt from OpenAlex's word -> positions index, or undefined. */
export function invertedAbstract(index: unknown): string | undefined {
  return (rawInvertedAbstract(index) as string | undefined) ?? undefined;
}

/** The seed's DOI, or the arXiv DOI for an arXiv paper, or undefined. */
export function seedDoi(doi: string | null | undefined, arxivId: string | null | undefined): string | undefined {
  return (rawSeedDoi(doi ?? undefined, arxivId ?? undefined) as string | undefined) ?? undefined;
}

/** The dedupe keys (DOIs, arXiv ids, title keys) of a library's papers. */
export function localKeys(papers: unknown): RelatedPaperKeys {
  return rawLocalKeys(papers) as RelatedPaperKeys;
}

/** Keeps the candidates not in the library or already kept, up to `limit`; takes the state back. */
export function collectNewHits(input: unknown): RelatedPaperCollectOutput {
  return rawCollectNewHits(input) as RelatedPaperCollectOutput;
}

/** Most cited first, stable; a missing hit or count ranks as 0. */
export function sortByCitations(hits: unknown): (RelatedPaperHitRow | null)[] {
  return rawSortByCitations(hits) as (RelatedPaperHitRow | null)[];
}

/** The Semantic Scholar field list asked of a paper nested under `key`. */
export function s2NestedFields(key: string): string {
  return rawS2NestedFields(key);
}
