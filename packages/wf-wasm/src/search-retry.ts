/**
 * Second-chance matching (Rust `search_retry`), re-exported from index.ts.
 * Keeps the shape of packages/core/src/search/search-retry.ts: `planFuzzyRetry`
 * returns `{ retry, fuzzinessFor }`, with the rule itself in Rust.
 */
import {
  retryFuzzinessForTerm as rawRetryFuzzinessForTerm,
  shouldRetrySearch as rawShouldRetrySearch,
} from "../pkg/wf_wasm.js";

export {
  retryFuzzinessForTerm,
  shouldRetrySearch,
} from "../pkg/wf_wasm.js";

/**
 * Decide whether, and how, to re-run a query that returned no results. The
 * fuzziness for each term is absolute (max edit distance), or 0 to leave it alone.
 */
export function planFuzzyRetry(input: { resultCount: number; termCount: number }): {
  retry: boolean;
  fuzzinessFor(term: string): number;
} {
  const retry = rawShouldRetrySearch(input.resultCount, input.termCount);
  return {
    retry,
    fuzzinessFor(term: string): number {
      return rawRetryFuzzinessForTerm(term, retry);
    },
  };
}
