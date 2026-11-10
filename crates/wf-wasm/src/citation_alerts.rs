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

/// [`intent_label`](citation_alerts::intent_label) of one candidate, or `undefined` when it has no intents.
///
/// # Errors
///
/// Fails if `candidate` has the wrong shape.
#[wasm_bindgen(js_name = citationIntentLabel)]
pub fn citation_intent_label_js(candidate: JsValue) -> JsResult<Option<String>> {
    let candidate: CitationSignals = serde_wasm_bindgen::from_value(candidate)?;
    Ok(citation_alerts::intent_label(&candidate))
}

/// [`merge_seen_ids`](citation_alerts::merge_seen_ids): prior ids, then new ones, each once.
#[wasm_bindgen(js_name = mergeSeenIds)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn merge_seen_ids_js(prior: Vec<String>, current: Vec<String>) -> Vec<String> {
    citation_alerts::merge_seen_ids(&prior, &current)
}
