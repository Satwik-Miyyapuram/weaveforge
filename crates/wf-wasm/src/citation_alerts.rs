//! Citation alert scores for JavaScript (wf-core `relations::citation_alerts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::citation_alerts::{self, CitationSignals};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`citation_alert_score`](citation_alerts::citation_alert_score) of each candidate, in order.
///
/// # Errors
///
/// Fails if `candidates` has the wrong shape.
#[wasm_bindgen(js_name = citationAlertScores)]
pub fn citation_alert_scores_js(candidates: JsValue) -> JsResult<Vec<f64>> {
    let candidates: Vec<CitationSignals> = serde_wasm_bindgen::from_value(candidates)?;
    Ok(candidates
        .iter()
        .map(citation_alerts::citation_alert_score)
        .collect())
}
