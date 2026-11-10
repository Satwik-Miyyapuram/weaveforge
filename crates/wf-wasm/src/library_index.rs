//! Library index rules for JavaScript (wf-core `search::library_index`).

use std::collections::BTreeMap;

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::search::library_index;

/// [`recent_failure_ids`](library_index::recent_failure_ids): the paper ids still inside the
/// retry window, from a record of `{ paperId: failedAtMs }`. A value that is not a number is not
/// returned, the same as a `NaN` time.
#[wasm_bindgen(js_name = recentFailureIds)]
pub fn recent_failure_ids_js(
    failures: JsValue,
    now: f64,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let record: BTreeMap<String, serde_json::Value> = serde_wasm_bindgen::from_value(failures)?;
    let pairs: Vec<(String, f64)> = record
        .into_iter()
        .filter_map(|(id, at)| at.as_f64().map(|time| (id, time)))
        .collect();
    serde_wasm_bindgen::to_value(&library_index::recent_failure_ids(&pairs, now))
}

/// [`courtesy_pause_due`](library_index::courtesy_pause_due).
#[wasm_bindgen(js_name = courtesyPauseDue)]
#[must_use]
pub fn courtesy_pause_due_js(from_cache: bool, indexed: u32, failed: u32) -> bool {
    library_index::courtesy_pause_due(from_cache, indexed as usize, failed as usize)
}
