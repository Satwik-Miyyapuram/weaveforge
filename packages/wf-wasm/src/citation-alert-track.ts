/**
 * Citation alert track row mapping (Rust `citation_alert_track`), re-exported from index.ts.
 * Keeps the signature of apps/web/src/features/relations/infrastructure/citation-alert-track-rows.ts.
 */
import { citationAlertTrackFromRow as rawCitationAlertTrackFromRow } from "../pkg/wf_wasm.js";
import type { CitationAlertTrack, CitationAlertTrackRow } from "./bindings.js";

/** A stored `citation_alert_tracks` row (Rust `CitationAlertTrackRow`) and the domain track (Rust `CitationAlertTrack`). */
export type { CitationAlertTrack, CitationAlertTrackRow } from "./bindings.js";

/** The domain track for a stored row. Null `last_checked_at` is absent, null `seen_citing_ids` empty. */
export function citationAlertTrackFromRow(row: CitationAlertTrackRow): CitationAlertTrack {
  return rawCitationAlertTrackFromRow(row) as CitationAlertTrack;
}
