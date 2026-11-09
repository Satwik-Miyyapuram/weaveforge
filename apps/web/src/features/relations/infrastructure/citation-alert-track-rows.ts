import type { CitationAlertTrack } from "@weaveforge/core";
import type { CitationAlertTrackRow } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/**
 * How citation alert track rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 *
 * The mapping itself is Rust (`citation_alert_track_from_row`); this file only names it.
 */

export type TrackRow = CitationAlertTrackRow;

export function toDomain(row: TrackRow): CitationAlertTrack {
  return readyCore().citationAlertTrackFromRow(row) as CitationAlertTrack;
}
