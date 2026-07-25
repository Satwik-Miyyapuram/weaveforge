import type { CitationCandidate, CitationIntent } from "./citation-source.js";

/**
 * Rank citation alerts by "should I read this?" signals.
 *
 * Higher score sorts first. Intent weight: result > method > background.
 * `isInfluential` is a strong boost. Missing signals do not penalise — absent
 * data is the normal case — so unsignalled items fall back to recency only.
 */

const INTENT_WEIGHT: Record<CitationIntent, number> = {
  result: 30,
  method: 20,
  background: 5,
};

const INFLUENTIAL_BONUS = 50;

/** Year contribution so newer work ranks above older when signals tie. */
function recencyScore(year: number | undefined): number {
  if (year == null || !Number.isFinite(year)) return 0;
  // Anchor around a mid-range so scores stay comparable across decades.
  return Math.max(0, year - 1900);
}

export function citationAlertScore(candidate: CitationCandidate): number {
  let score = recencyScore(candidate.year);
  if (candidate.isInfluential === true) score += INFLUENTIAL_BONUS;
  if (candidate.intents?.length) {
    let best = 0;
    for (const intent of candidate.intents) {
      const w = INTENT_WEIGHT[intent];
      if (w != null && w > best) best = w;
    }
    score += best;
  }
  return score;
}

/**
 * Sort a copy of `candidates` by descending alert score, then by title for
 * stability. Does not mutate the input.
 */
export function rankCitationAlerts(
  candidates: readonly CitationCandidate[],
): CitationCandidate[] {
  return [...candidates].sort((a, b) => {
    const diff = citationAlertScore(b) - citationAlertScore(a);
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });
}
