//! Title acronym helpers for JavaScript (wf-core `search::acronyms`). The JS name matches
//! `packages/core/src/search/search-acronyms.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::acronyms;

use super::to_js;

/// [`acronyms_for_title`](acronyms::acronyms_for_title) as a JS array of strings.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = acronymsForTitle, unchecked_return_type = "string[]")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn acronyms_for_title_js(title: String) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&acronyms::acronyms_for_title(&title))
}
