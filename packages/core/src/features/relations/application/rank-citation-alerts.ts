import type { CitationCandidate } from "./citation-source.js";

/**
 * Ranking citation alerts by "should I read this?" signals moved to the Rust
 * core (wf-core `relations::citation_alerts`). Higher score sorts first: intent
 * weight result > method > background, a strong `isInfluential` boost, and
 * recency when the signals tie.
 */
export interface RankCitationAlertsFns {
  /** One candidate's alert score. */
  citationAlertScore(candidate: CitationCandidate): number;
  /** A copy of `candidates`, highest score first, then by title and id. Does not mutate the input. */
  rankCitationAlerts<T extends CitationCandidate>(candidates: readonly T[]): T[];
}
