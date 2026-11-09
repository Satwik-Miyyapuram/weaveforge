//! Recent-query list for JavaScript (wf-core `search_history`). The JS names match
//! `packages/core/src/search/search-history.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_history;

/// [`remember_search_query`](search_history::remember_search_query).
#[wasm_bindgen(js_name = rememberSearchQuery)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings and vectors by value"
)]
pub fn remember_search_query_js(history: Vec<String>, query: String, max: u32) -> Vec<String> {
    search_history::remember_search_query(&history, &query, max as usize)
}

/// [`forget_search_query`](search_history::forget_search_query).
#[wasm_bindgen(js_name = forgetSearchQuery)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings and vectors by value"
)]
pub fn forget_search_query_js(history: Vec<String>, query: String) -> Vec<String> {
    search_history::forget_search_query(&history, &query)
}

/// [`normalize_search_history`](search_history::normalize_search_history). Any
/// non-array input yields an empty list.
///
/// # Errors
///
/// Fails only if `raw` cannot be read as JSON-like data.
#[wasm_bindgen(js_name = normalizeSearchHistory)]
pub fn normalize_search_history_js(
    raw: JsValue,
    max: u32,
) -> Result<Vec<String>, serde_wasm_bindgen::Error> {
    let raw: serde_json::Value = serde_wasm_bindgen::from_value(raw)?;
    Ok(search_history::normalize_search_history(&raw, max as usize))
}
