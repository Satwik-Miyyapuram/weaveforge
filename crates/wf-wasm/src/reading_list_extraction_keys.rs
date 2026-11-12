//! Extraction-table cell keys and relation labels for JavaScript (wf-core
//! `reading_lists::extraction_keys`). The JS names match the removed TS helpers.

use std::collections::HashMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::extraction_keys;

/// [`pending_key`](extraction_keys::pending_key): the `paper::field` lookup key for one cell.
#[wasm_bindgen(js_name = pendingKey)]
#[must_use]
pub fn pending_key_js(paper_id: &str, field_id: &str) -> String {
    extraction_keys::pending_key(paper_id, field_id)
}

/// [`relation_titles`](extraction_keys::relation_titles): the related papers' titles joined by
/// `, `, with an unknown id shown as itself.
///
/// # Errors
///
/// Fails if `ids` is not an array of strings or `titles` is not a map (or object) of strings.
#[wasm_bindgen(js_name = relationTitles)]
pub fn relation_titles_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] ids: JsValue,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, string>")] titles: JsValue,
) -> Result<String, JsValue> {
    let ids: Vec<String> = serde_wasm_bindgen::from_value(ids)?;
    let titles: HashMap<String, String> = serde_wasm_bindgen::from_value(titles)?;
    Ok(extraction_keys::relation_titles(&ids, &titles))
}
