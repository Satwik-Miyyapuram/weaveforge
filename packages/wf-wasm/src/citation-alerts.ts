/**
 * Citation alert ranking (Rust `relations::citation_alerts`), re-exported
 * from index.ts. Rust scores each candidate; equal scores keep the old
 * locale-aware title, then id, order.
 */
import {
  citationAlertScores as rawCitationAlertScores,
  mergeSeenIds as rawMergeSeenIds,
} from "../pkg/wf_wasm.js";
import type { CitationSignals } from "./bindings.js";

export {
  citationIntentLabel,
} from "../pkg/wf_wasm.js";

/** The "should I read this?" score of each candidate, in order. */
export function citationAlertScores(candidates: readonly CitationSignals[]): number[] {
  return Array.from(rawCitationAlertScores(candidates));
}

/** Prior seen ids, then each new id once, in first-seen order. Prior ids always survive. */
export function mergeSeenIds(prior: readonly string[], currentIds: readonly string[]): string[] {
  return Array.from(rawMergeSeenIds([...prior], [...currentIds]));
}

/** One candidate's score: recency, the influential bonus and its strongest intent. */
export function citationAlertScore(candidate: CitationSignals): number {
  return citationAlertScores([candidate])[0] ?? 0;
}

/**
 * A copy of `candidates`, highest score first, then by title and id. Does not
 * mutate the input.
 */
export function rankCitationAlerts<T extends CitationSignals & { id: string; title: string }>(
  candidates: readonly T[],
): T[] {
  const scores = citationAlertScores(candidates);
  return candidates
    .map((candidate, i) => ({ candidate, score: scores[i] ?? 0 }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.title.localeCompare(b.candidate.title, "en") ||
        a.candidate.id.localeCompare(b.candidate.id, "en"),
    )
    .map(({ candidate }) => candidate);
}
