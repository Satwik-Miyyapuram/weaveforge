import type {
  CitationAlertTrack,
} from "@weaveforge/core";

/**
 * How citation alert track rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface TrackRow {
  id: string;
  paper_id: string;
  tracked_at: string;
  last_checked_at: string | null;
  seen_citing_ids: string[] | null;
}

export function toDomain(row: TrackRow): CitationAlertTrack {
  return {
    id: row.id,
    paperId: row.paper_id,
    trackedAt: row.tracked_at,
    lastCheckedAt: row.last_checked_at ?? undefined,
    seenCitingIds: row.seen_citing_ids ?? [],
  };
}
