//! The status bar's document numbers (wf-core `editor_workspace::document_stats`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::document_stats as stats;

use super::to_js;

/// [`body_stats`](stats::body_stats).
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = bodyStats)]
pub fn body_stats_js(body: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&stats::body_stats(body))
}

/// [`format_count`](stats::format_count).
#[wasm_bindgen(js_name = formatCount)]
#[must_use]
pub fn format_count_js(value: f64) -> String {
    stats::format_count(value)
}

/// [`format_words`](stats::format_words).
#[wasm_bindgen(js_name = formatWords)]
#[must_use]
pub fn format_words_js(words: u32) -> String {
    stats::format_words(words)
}

/// [`format_cursor`](stats::format_cursor).
#[wasm_bindgen(js_name = formatCursorLabel)]
#[must_use]
pub fn format_cursor_js(line: u32, col: u32) -> String {
    stats::format_cursor(line, col)
}
