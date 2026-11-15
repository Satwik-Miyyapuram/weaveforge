//! Zotero annotation and note rows (wf-core `papers::zotero_annotations`).

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::zotero_annotations::{ZoteroItemRow, note_from_item};

use super::to_js;

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

fn out<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`note_from_item`] (TS `zoteroNoteFromItem`). The note, or `undefined` when it has no text.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(
    js_name = zoteroNoteFromItem,
    unchecked_return_type = "B.ZoteroAnnotation | undefined"
)]
pub fn zotero_note_from_item_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroItemRow")] item: JsValue,
) -> Result<JsValue, JsError> {
    let item: ZoteroItemRow = from_js(item)?;
    match note_from_item(&item) {
        Some(note) => out(&note),
        None => Ok(JsValue::UNDEFINED),
    }
}
