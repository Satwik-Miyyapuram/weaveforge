//! Citation alert track row mapping for JavaScript (wf-core `citation_alert_track`). The JS
//! name matches `apps/web/src/features/relations/infrastructure/citation-alert-track-rows.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::citation_alert_track::{self, CitationAlertTrackRow};

use super::to_js;

/// [`citation_alert_track_from_row`](citation_alert_track::citation_alert_track_from_row):
/// the domain track for a stored row (null `last_checked_at` reads as absent, null
/// `seen_citing_ids` as empty).
///
/// # Errors
///
/// Fails if `row` has the wrong shape.
#[wasm_bindgen(
    js_name = citationAlertTrackFromRow,
    unchecked_return_type = "B.CitationAlertTrack"
)]
pub fn citation_alert_track_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.CitationAlertTrackRow")] row: JsValue,
) -> Result<JsValue, JsValue> {
    let row: CitationAlertTrackRow = serde_wasm_bindgen::from_value(row)?;
    Ok(to_js(
        &citation_alert_track::citation_alert_track_from_row(row),
    )?)
}
