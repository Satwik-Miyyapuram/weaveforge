//! The Outline section's headings (wf-core `editor_workspace::outline`),
//! re-exported from `packages/wf-wasm/src/outline.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::editor_workspace::outline;

use super::to_js;

/// [`outline_of`](outline::outline_of) as an array of `{ level, text, slug }`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = outlineOf)]
pub fn outline_of_js(body: &str, max_level: u32) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let max_level = usize::try_from(max_level).unwrap_or(usize::MAX);
    to_js(&outline::outline_of(body, max_level))
}
