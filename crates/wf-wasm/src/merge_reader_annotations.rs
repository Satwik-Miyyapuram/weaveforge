//! wasm export for `reader::merge_annotations` (TS: `merge-reader-annotations.ts`).

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::merge_annotations;

use super::to_js;

/// [`merge_reader_annotations`](merge_annotations::merge_reader_annotations): Zotero and
/// local rows as one list sorted by `sortIndex`. Rows come back as copies, not the same
/// objects, and an `undefined` field reads back as `null`.
///
/// # Errors
///
/// Fails if either argument is not an array, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = mergeReaderAnnotations)]
pub fn merge_reader_annotations_js(
    zotero: JsValue,
    local: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let zotero: Vec<Value> = serde_wasm_bindgen::from_value(zotero)?;
    let local: Vec<Value> = serde_wasm_bindgen::from_value(local)?;
    to_js(&merge_annotations::merge_reader_annotations(
        &zotero, &local,
    ))
}
