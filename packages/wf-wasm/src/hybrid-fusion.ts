/**
 * Hybrid fusion helpers (Rust `hybrid_fusion`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/hybrid-fusion.ts.
 */
import { coveredHitMask, gateVectorMask } from "../pkg/wf_wasm.js";

export {
  coveredHitMask,
  gateVectorMask,
  queryTermCount,
  stripStopwords,
} from "../pkg/wf_wasm.js";

/** Weight of the vector list in fusion; the keyword list is 1. */
export const HYBRID_VECTOR_WEIGHT = 1.5;
/** Fewest of the query's content terms a keyword hit must match to be fused. */
export const HYBRID_MIN_TERM_COVERAGE = 0.5;
/** Top vector hits kept even under the encoder's floor once the best hit clears it. */
export const HYBRID_VECTOR_KEEP_TOP = 5;

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
