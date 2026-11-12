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
#[wasm_bindgen(js_name = bodyStats, unchecked_return_type = "B.BodyStats")]
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

/// A cursor position as the status bar holds it.
#[derive(serde::Deserialize)]
struct Cursor {
    line: f64,
    col: f64,
}

/// [`format_cursor`](stats::format_cursor) of `{ line, col }`: "Ln 7, Col 4".
///
/// # Errors
///
/// Fails if `cursor` has no numeric `line` and `col`.
#[wasm_bindgen(js_name = formatCursor)]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // Line and column are small counts.
pub fn format_cursor_js(
    #[wasm_bindgen(unchecked_param_type = "{ line: number; col: number }")] cursor: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let cursor: Cursor = serde_wasm_bindgen::from_value(cursor)?;
    Ok(stats::format_cursor(cursor.line as u32, cursor.col as u32))
}
