//! Recent-query list for JavaScript (wf-core `search_history`). The JS names match
//! `packages/core/src/search/search-history.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_history;

/// [`remember_search_query`](search_history::remember_search_query): prepend a query,
/// most-recent first. `max` defaults to [`MAX_SEARCH_HISTORY`](search_history::MAX_SEARCH_HISTORY).
#[wasm_bindgen(js_name = rememberSearchQuery)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings and vectors by value"
)]
pub fn remember_search_query_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] history: Vec<String>,
    query: String,
    max: Option<u32>,
) -> Vec<String> {
    let max = max.map_or(search_history::MAX_SEARCH_HISTORY, |m| m as usize);
    search_history::remember_search_query(&history, &query, max)
}

/// [`forget_search_query`](search_history::forget_search_query).
#[wasm_bindgen(js_name = forgetSearchQuery)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings and vectors by value"
)]
pub fn forget_search_query_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] history: Vec<String>,
    query: String,
) -> Vec<String> {
    search_history::forget_search_query(&history, &query)
}

/// [`normalize_search_history`](search_history::normalize_search_history). Any
/// non-array input yields an empty list. `max` defaults to
/// [`MAX_SEARCH_HISTORY`](search_history::MAX_SEARCH_HISTORY).
///
/// # Errors
///
/// Fails only if `raw` cannot be read as JSON-like data.
#[wasm_bindgen(js_name = normalizeSearchHistory)]
pub fn normalize_search_history_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: JsValue,
    max: Option<u32>,
) -> Result<Vec<String>, serde_wasm_bindgen::Error> {
    let raw: serde_json::Value = serde_wasm_bindgen::from_value(raw)?;
    let max = max.map_or(search_history::MAX_SEARCH_HISTORY, |m| m as usize);
    Ok(search_history::normalize_search_history(&raw, max))
}
