/**
 * Citation alert track row mapping (Rust `citation_alert_track`), re-exported from index.ts.
 * Callers use readyCore().citationAlertTrackFromRow; the TS shim it replaced is removed.
 */
export { citationAlertTrackFromRow } from "../pkg/wf_wasm.js";

/** A stored `citation_alert_tracks` row (Rust `CitationAlertTrackRow`) and the domain track (Rust `CitationAlertTrack`). */
export type { CitationAlertTrack, CitationAlertTrackRow } from "./bindings.js";
