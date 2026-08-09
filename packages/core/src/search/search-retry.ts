/**
 * Second-chance matching for a query that found nothing.
 *
 * `fuzzinessForTerm` is deliberately conservative, because fuzziness is not
 * free: every extra edit of tolerance pulls in more unrelated documents for
 * every query that was already working. Raising it across the board to rescue
 * typos would make the common case worse to improve the uncommon one.
 *
 * So the tolerance is escalated only when the ordinary search returns nothing.
 * A query with results is left exactly as it was; a query with none has nothing
 * to lose. The cost is one extra pass over an in-memory index, and only on the
 * queries that already failed.
 *
 * ## Why the escalation is +1 edit rather than a bigger jump
 *
 * The gap it closes is transpositions. MiniSearch measures Levenshtein
 * distance, in which a single swapped pair of adjacent letters — "nerual" for
 * "neural", "attnetion" for "attention" — counts as **two** edits, not one.
 * Damerau-Levenshtein counts it as one, which is why swaps feel like they
 * should be forgiven and are not. A six-letter word gets a maximum distance of
 * one at 0.2 fuzziness, so it can never reach its own transposition; one more
 * edit is exactly enough, and no more than is needed.
 */

import { fuzzinessForTerm } from "./search-tuning.js";

/** Longest query that is worth retrying. Beyond this, silence is an answer. */
const MAX_RETRY_TERMS = 4;

/**
 * Terms shorter than this are not retried. At three characters an extra edit of
 * tolerance matches a large fraction of the dictionary, which is noise rather
 * than help.
 */
const MIN_RETRY_TERM_LENGTH = 4;

export interface FuzzyRetryPlan {
  /** Whether a second pass is worth making at all. */
  retry: boolean;
  /**
   * Absolute maximum edit distance for the retry, or 0 to leave a term alone.
   * Absolute rather than fractional because the point is "one more than last
   * time", which a fraction cannot express.
   */
  fuzzinessFor(term: string): number;
}

/**
 * Decide whether — and how — to re-run a query that returned no results.
 *
 * `termCount` guards the pathological case: a long query returning nothing is
 * usually a genuine absence, and loosening every term of it produces a pile of
 * weakly-related documents rather than the one thing that was meant.
 */
export function planFuzzyRetry(input: {
  resultCount: number;
  termCount: number;
}): FuzzyRetryPlan {
  const retry = input.resultCount === 0 && input.termCount > 0 && input.termCount <= MAX_RETRY_TERMS;

  return {
    retry,
    fuzzinessFor(term: string): number {
      if (!retry || term.length < MIN_RETRY_TERM_LENGTH) return 0;
      // One edit beyond what the first pass allowed — enough for a swap.
      const firstPass = Math.round(fuzzinessForTerm(term) * term.length);
      return firstPass + 1;
    },
  };
}
