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
