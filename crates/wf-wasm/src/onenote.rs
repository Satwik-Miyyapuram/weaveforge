//! wasm exports for `onenote` (TS: `features/vault/application/onenote-import.ts`).

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

/// [`onenote::freeform_page_text`]: JSON Canvas text for a freeform page. `layout`
/// is a `OneNoteLayoutItem[]`, `files` maps each image name to its vault path and
/// `ink` is the page's `OneNoteInkPage[]`.
///
/// # Errors
///
/// Fails when an argument has the wrong shape.
#[wasm_bindgen(js_name = oneNoteFreeformText)]
pub fn one_note_freeform_text_js(
    #[wasm_bindgen(unchecked_param_type = "B.OneNoteLayoutItem[]")] layout: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Record<string, string>")] files: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.OneNoteInkPage[]")] ink: JsValue,
) -> Result<String, JsError> {
    let layout: Vec<onenote::OneNoteLayoutItem> =
        serde_wasm_bindgen::from_value(layout).map_err(|e| JsError::new(&e.to_string()))?;
    let files: std::collections::BTreeMap<String, String> =
        serde_wasm_bindgen::from_value(files).map_err(|e| JsError::new(&e.to_string()))?;
    let ink: Vec<onenote::OneNoteInkPage> =
        serde_wasm_bindgen::from_value(ink).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(onenote::freeform_page_text(&layout, &files, &ink))
}
