/**
 * Near-miss vocabulary matching for recognised ink text (Rust
 * `ink::vocab_match`), re-exported from index.ts.
 */
import {
  damerauLevenshtein as rawDamerauLevenshtein,
  matchVocabulary as rawMatchVocabulary,
  spanDistance as rawSpanDistance,
} from "../pkg/wf_wasm.js";

import type { VocabMatch, VocabMatchResult } from "./bindings.js";

export type { VocabMatch, VocabMatchResult };

/** Damerau–Levenshtein distance with adjacent transpositions, in UTF-16 units. */
export function damerauLevenshtein(a: string, b: string): number {
  return rawDamerauLevenshtein(a, b);
}

/** The distance between a run of words and an entry, `Infinity` when refused. */
export function spanDistance(
  words: readonly string[],
  entryWords: readonly string[],
): number {
  return rawSpanDistance(words, entryWords);
}

/** Rewrite the near-misses in one line against the vocabulary, then the symbols. */
export function matchVocabulary(
  text: string,
  vocabulary: readonly string[],
): VocabMatchResult {
  return rawMatchVocabulary(text, vocabulary);
}
