//! Card preview text for JavaScript (wf-core `card_snippet`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::card_snippet;

/// [`card_snippet::card_snippet`]: plain-text preview of `body`, cut to `max` UTF-16 units.
///
/// # Errors
///
/// Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = cardSnippet)]
pub fn card_snippet_js(
    body: js_sys::JsString,
    max: Option<usize>,
) -> Result<String, serde_wasm_bindgen::Error> {
    let body = &crate::guarded_text(&body)?;
    Ok(card_snippet::card_snippet(body, max.unwrap_or(180)))
}
