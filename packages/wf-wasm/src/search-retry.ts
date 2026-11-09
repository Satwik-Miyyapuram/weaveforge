/**
 * Second-chance matching (Rust `search_retry`), re-exported from index.ts.
 * Keeps the shape of packages/core/src/search/search-retry.ts: `planFuzzyRetry`
 * returns `{ retry, fuzzinessFor }`, with the rule itself in Rust.
 */
import {
  retryFuzzinessForTerm as rawRetryFuzzinessForTerm,
  shouldRetrySearch as rawShouldRetrySearch,
} from "../pkg/wf_wasm.js";

/** Whether a query that found `resultCount` hits over `termCount` terms gets a fuzzy retry. */
export function shouldRetrySearch(resultCount: number, termCount: number): boolean {
  return rawShouldRetrySearch(resultCount, termCount);
}

/** Max edit distance for `term` on a retry, or 0 to leave it exact. Always 0 when `retry` is false. */
export function retryFuzzinessForTerm(term: string, retry: boolean): number {
  return rawRetryFuzzinessForTerm(term, retry);
}

/**
 * Decide whether, and how, to re-run a query that returned no results. The
 * fuzziness for each term is absolute (max edit distance), or 0 to leave it alone.
 */
export function planFuzzyRetry(input: { resultCount: number; termCount: number }): {
  retry: boolean;
  fuzzinessFor(term: string): number;
} {
  const retry = shouldRetrySearch(input.resultCount, input.termCount);
  return {
    retry,
    fuzzinessFor(term: string): number {
      return retryFuzzinessForTerm(term, retry);
    },
  };
}
