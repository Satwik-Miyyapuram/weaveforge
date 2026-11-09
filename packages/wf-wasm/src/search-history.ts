/**
 * Recent-query list (Rust `search_history`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/search/search-history.ts.
 */
import {
  forgetSearchQuery as rawForgetSearchQuery,
  normalizeSearchHistory as rawNormalizeSearchHistory,
  rememberSearchQuery as rawRememberSearchQuery,
} from "../pkg/wf_wasm.js";

export const MAX_SEARCH_HISTORY = 12;

/** Prepend a query, most-recent first. Repeats and abandoned prefixes are dropped. */
export function rememberSearchQuery(
  history: readonly string[],
  query: string,
  max = MAX_SEARCH_HISTORY,
): string[] {
  return rawRememberSearchQuery([...history], query, max);
}

export function forgetSearchQuery(history: readonly string[], query: string): string[] {
  return rawForgetSearchQuery([...history], query);
}

/** Drop anything that is not a usable query string. Non-array input yields []. */
export function normalizeSearchHistory(raw: unknown, max = MAX_SEARCH_HISTORY): string[] {
  return rawNormalizeSearchHistory(raw, max);
}
