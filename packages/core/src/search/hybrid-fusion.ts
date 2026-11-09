/** Types for hybrid-fusion. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface HybridFusionFns {
  /**
 * How the keyword and vector arms are prepared before rank fusion.
 *
 * Measured on a 98-query set over a 39-paper library (see
 * `docs/plans/current/search.md`, "Hybrid fusion benchmark"): plain RRF of the
 * raw keyword list and the floored vector list scored MRR@10 0.791 — *below*
 * the vector arm alone (0.831). The keyword arm matches with OR, so a
 * paraphrased question put every document sharing "of" or "networks" into the
 * fused list, pushing the right answer down and making off-topic queries
 * ("how cooking pasta works") return results 10 times out of 10.
 *
 * The three changes here lifted it to 0.837 with off-topic queries answering
 * 1/10, while keyword-style queries (names, acronyms) improved too:
 * function words are dropped from the keyword arm's query, a keyword hit must
 * match at least half the remaining terms, and the vector arm counts for 1.5×.
 */

/** Weight of the vector list in fusion; the keyword list is 1. */
  readonly HYBRID_VECTOR_WEIGHT: 1.5;
  /** Fewest of the query's content terms a keyword hit must match to be fused. */
  readonly HYBRID_MIN_TERM_COVERAGE: 0.5;
  /**
 * Once the best vector hit clears the encoder's floor, this many of the top
 * hits are kept even if they fall under it — a confident query deserves its
 * near misses; an unconfident one gets nothing.
 */
  readonly HYBRID_VECTOR_KEEP_TOP: 5;
  /**
 * The query with bare function words removed, for the keyword arm.
 *
 * Only plain words go: `kind:note`, quoted phrases and `-exclusions` are
 * syntax and pass through. A query that is nothing but stopwords is returned
 * whole — "the who" should still search for something.
 */
  stripStopwords(query: string): string;
  /** Distinct non-empty terms; callers pass the query's index terms (the Rust `indexTerms`). */
  queryTermCount(terms: readonly string[]): number;
  /**
 * Keyword hits that matched enough of the query to be worth fusing.
 *
 * `queryTerms` are the query's own terms a hit matched (not the document forms
 * a prefix or fuzzy match expanded them to). A hit that does not report them
 * is kept: the filter must never be the reason something vanishes.
 */
  coveredHits<T extends { queryTerms?: readonly string[] }>(hits: readonly T[], termCount: number, minCoverage?: number): T[];
  /**
 * Vector hits, best first, gated by the encoder's floor.
 *
 * Nothing when the best hit is under the floor; otherwise the top
 * `keepTop` plus anything else above it.
 */
  gateVectorHits<T extends { score: number }>(hits: readonly T[], floor: number, keepTop?: number): T[];
}
