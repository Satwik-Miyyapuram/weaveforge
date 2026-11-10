//! wasm export for `reader::split` (TS: `reader-split.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::split;

use super::to_js;

/// [`parse_reader_split_pane`](split::parse_reader_split_pane); `null` for any value
/// other than `report` or `vault`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = parseReaderSplitPane, unchecked_return_type = "B.ReaderSplitPane | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn parse_reader_split_pane_js(
    raw: Option<String>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&split::parse_reader_split_pane(raw.as_deref()))
}
