/**
 * Hybrid fusion helpers (Rust `hybrid_fusion`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/hybrid-fusion.ts.
 */
import {
  coveredHitMask as rawCoveredHitMask,
  gateVectorMask as rawGateVectorMask,
} from "../pkg/wf_wasm.js";

export {
  queryTermCount,
} from "../pkg/wf_wasm.js";

export {
  stripStopwords,
} from "../pkg/wf_wasm.js";

/** Weight of the vector list in fusion; the keyword list is 1. */
export const HYBRID_VECTOR_WEIGHT = 1.5;
/** Fewest of the query's content terms a keyword hit must match to be fused. */
export const HYBRID_MIN_TERM_COVERAGE = 0.5;
/** Top vector hits kept even under the encoder's floor once the best hit clears it. */
export const HYBRID_VECTOR_KEEP_TOP = 5;

/** Per hit (its matched-term count, or null), whether it covers enough of the query. */
export function coveredHitMask(
  queryTermCounts: readonly (number | null)[],
  termCount: number,
  minCoverage: number,
): boolean[] {
  return rawCoveredHitMask(queryTermCounts, termCount, minCoverage) as boolean[];
}

/** Per score (best first), whether the vector hit survives the floor. */
export function gateVectorMask(scores: readonly number[], floor: number, keepTop: number): boolean[] {
  return rawGateVectorMask(scores, floor, keepTop) as boolean[];
}

/** Keyword hits that matched enough of the query to be worth fusing. */
export function coveredHits<T extends { queryTerms?: readonly string[] }>(
  hits: readonly T[],
  termCount: number,
  minCoverage = HYBRID_MIN_TERM_COVERAGE,
): T[] {
  const mask = coveredHitMask(
    hits.map((hit) => hit.queryTerms?.length ?? null),
    termCount,
    minCoverage,
  );
  return hits.filter((_, position) => mask[position]);
}

/** Vector hits, best first, gated by the encoder's floor. */
export function gateVectorHits<T extends { score: number }>(
  hits: readonly T[],
  floor: number,
  keepTop = HYBRID_VECTOR_KEEP_TOP,
): T[] {
  const mask = gateVectorMask(hits.map((hit) => hit.score), floor, keepTop);
  return hits.filter((_, position) => mask[position]);
}
