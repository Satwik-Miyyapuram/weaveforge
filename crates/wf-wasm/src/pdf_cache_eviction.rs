//! wasm export for `reader::pdf_cache_eviction` (TS: `pdf-cache-eviction.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::reader::pdf_cache_eviction::{CachedPdfAge, pick_keys_to_evict};

use super::to_js;

/// [`pick_keys_to_evict`]: the keys to drop, oldest first. Throws an `Error` when
/// `maxEntries` is not a positive integer.
///
/// # Errors
///
/// Fails if `maxEntries` is not a positive integer, or `entries` has the wrong shape.
#[wasm_bindgen(js_name = pickKeysToEvict, unchecked_return_type = "string[]")]
pub fn pick_keys_to_evict_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.CachedPdfAge[]")] entries: JsValue,
    max_entries: f64,
) -> Result<JsValue, JsError> {
    let entries: Vec<CachedPdfAge> = serde_wasm_bindgen::from_value(entries)
        .map_err(|error| JsError::new(&error.to_string()))?;
    let keys = pick_keys_to_evict(&entries, max_entries).map_err(JsError::new)?;
    to_js(&keys).map_err(|error| JsError::new(&error.to_string()))
}
