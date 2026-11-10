//! Zotero annotation and note rows (wf-core `papers::zotero_annotations`). The TS wrapper
//! in `packages/wf-wasm/src/papers-zotero-annotations.ts` is what callers import.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::zotero_annotations::{
    ZoteroItemRow, annotation_from_item, is_pdf_attachment, item_key, note_from_item, pick_main_pdf,
};

use super::to_js;

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

fn out<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`item_key`] (TS `zoteroItemKey`). The key, or null.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroItemKey)]
pub fn zotero_item_key_js(item: JsValue) -> Result<JsValue, JsError> {
    let item: ZoteroItemRow = from_js(item)?;
    out(&item_key(&item))
}

/// [`is_pdf_attachment`] (TS `zoteroIsPdfAttachment`).
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroIsPdfAttachment, unchecked_return_type = "boolean")]
pub fn zotero_is_pdf_attachment_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroItemRow")] item: JsValue,
) -> Result<JsValue, JsError> {
    let item: ZoteroItemRow = from_js(item)?;
    out(&is_pdf_attachment(&item))
}

/// [`pick_main_pdf`] (TS `zoteroPickMainPdf`). The main PDF's key, or null.
///
/// # Errors
///
/// Fails if `pdfs` is not an array of Zotero items.
#[wasm_bindgen(js_name = zoteroPickMainPdf)]
pub fn zotero_pick_main_pdf_js(pdfs: JsValue) -> Result<JsValue, JsError> {
    let pdfs: Vec<ZoteroItemRow> = from_js(pdfs)?;
    out(&pick_main_pdf(&pdfs))
}

/// [`annotation_from_item`] (TS `zoteroAnnotationFromItem`).
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroAnnotationFromItem, unchecked_return_type = "B.ZoteroAnnotation")]
pub fn zotero_annotation_from_item_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroItemRow")] item: JsValue,
) -> Result<JsValue, JsError> {
    let item: ZoteroItemRow = from_js(item)?;
    out(&annotation_from_item(&item))
}

/// [`note_from_item`] (TS `zoteroNoteFromItem`). The note, or null when it has no text.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroNoteFromItem)]
pub fn zotero_note_from_item_js(item: JsValue) -> Result<JsValue, JsError> {
    let item: ZoteroItemRow = from_js(item)?;
    out(&note_from_item(&item))
}
