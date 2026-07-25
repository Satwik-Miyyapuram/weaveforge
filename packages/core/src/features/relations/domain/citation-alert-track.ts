import type { Identifiable } from "../../../shared/repository.js";

/** Project-scoped citation alert for one library paper. */
export interface CitationAlertTrack extends Identifiable {
  id: string;
  paperId: string;
  trackedAt: string;
  /** Null until the first successful poll after tracking starts. */
  lastCheckedAt?: string;
  /** Stable Semantic Scholar (or other source) citing-paper ids already seen. */
  seenCitingIds: string[];
}

export interface NewCitationAlertTrackInput {
  paperId: string;
  seenCitingIds?: string[];
  lastCheckedAt?: string;
}

export class CitationAlertTrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CitationAlertTrackError";
  }
}
