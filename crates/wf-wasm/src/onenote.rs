//! wasm exports for `onenote` (TS: `features/vault/application/onenote-import.ts`).

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::onenote;

use super::to_js;

/// [`onenote::import_section`]: a `.one` section's pages as text, images and ink strokes.
///
/// # Errors
///
/// Fails when the bytes are not a OneNote section, are over the size cap, or
/// the result cannot be converted to JS.
#[wasm_bindgen(js_name = importOneNoteSection, unchecked_return_type = "B.OneNoteSection")]
pub fn import_one_note_section_js(bytes: &[u8], file_name: &str) -> Result<JsValue, JsError> {
    let section = onenote::import_section(bytes, file_name).map_err(|e| JsError::new(&e))?;
    to_js(&section).map_err(|e| JsError::new(&e.to_string()))
}

/// [`onenote::page_canvas`]: JSON Canvas text for a page's layout. `layout` is a
/// `OneNoteLayoutItem[]`; `files` maps each image name and `ink-N` key to its vault path.
///
/// # Errors
///
/// Fails if `layout` or `files` has the wrong shape.
#[wasm_bindgen(js_name = oneNoteCanvasText)]
pub fn one_note_canvas_text_js(
    #[wasm_bindgen(unchecked_param_type = "B.OneNoteLayoutItem[]")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, string>")] files: JsValue,
) -> Result<String, JsError> {
    let layout: Vec<onenote::OneNoteLayoutItem> =
        serde_wasm_bindgen::from_value(layout).map_err(|e| JsError::new(&e.to_string()))?;
    let files: BTreeMap<String, String> =
        serde_wasm_bindgen::from_value(files).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(onenote::page_canvas(&layout, &files))
}
