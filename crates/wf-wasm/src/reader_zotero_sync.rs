//! Zotero write-back decisions, field diffs, conflict merges and payloads for JavaScript.
//! Each export wraps a `wf_core::reader::zotero_sync` function; the JS shapes match
//! `packages/core/src/reader/zotero-write-back.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::zotero_sync::{
    ZoteroAnnotationLocal, ZoteroAnnotationSyncRow, ZoteroSyncLibraryMode, decide_annotation_sync,
    diff_annotation_fields, is_zotero_library_sync_mode, resolve_annotation_conflict,
    to_zotero_write_payload, zotero_write_back_annotations,
};

use wf_core::reader::zotero_write_back_message::{WriteBackSummary, zotero_write_back_message};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_zotero_library_sync_mode`] for any JS value: false unless `value` is a string.
#[must_use]
#[wasm_bindgen(js_name = isZoteroLibrarySyncMode)]
pub fn is_zotero_library_sync_mode_js(
    #[wasm_bindgen(unchecked_param_type = "string")] value: &JsValue,
) -> bool {
    value
        .as_string()
        .is_some_and(|s| is_zotero_library_sync_mode(&s))
}

/// [`decide_annotation_sync`] for a row and a mode string (unknown modes act as `bidirectional`).
///
/// # Errors
///
/// Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
#[wasm_bindgen(js_name = decideAnnotationSync)]
pub fn decide_annotation_sync_js(row: JsValue, mode: &str) -> JsResult<JsValue> {
    let row: ZoteroAnnotationSyncRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&decide_annotation_sync(
        &row,
        ZoteroSyncLibraryMode::from_js(mode),
    ))
}

/// [`diff_annotation_fields`] for a row: the fields that differ, in TS order.
///
/// # Errors
///
/// Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
#[wasm_bindgen(js_name = diffAnnotationFields, unchecked_return_type = "B.ZoteroAnnotationFieldConflict[]")]
pub fn diff_annotation_fields_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroAnnotationSyncRow")] row: JsValue,
) -> JsResult<JsValue> {
    let row: ZoteroAnnotationSyncRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&diff_annotation_fields(&row))
}

/// [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
///
/// # Errors
///
/// Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
#[wasm_bindgen(js_name = resolveAnnotationConflict, unchecked_return_type = "B.ZoteroAnnotationLocal | null")]
pub fn resolve_annotation_conflict_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroAnnotationSyncRow")] row: JsValue,
    choice: &str,
) -> JsResult<JsValue> {
    let row: ZoteroAnnotationSyncRow = serde_wasm_bindgen::from_value(row)?;
    to_js(&resolve_annotation_conflict(&row, choice))
}

/// [`to_zotero_write_payload`] for one annotation under a parent item key.
///
/// # Errors
///
/// Fails if `ann` is not a `ZoteroAnnotationLocal` object.
#[wasm_bindgen(js_name = toZoteroWritePayload, unchecked_return_type = "B.ZoteroAnnotationWritePayload")]
pub fn to_zotero_write_payload_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroAnnotationLocal")] ann: JsValue,
    parent_item_key: &str,
) -> JsResult<JsValue> {
    let ann: ZoteroAnnotationLocal = serde_wasm_bindgen::from_value(ann)?;
    to_js(&to_zotero_write_payload(&ann, parent_item_key))
}

/// [`zotero_write_back_annotations`]: indices of the annotations a write-back sends.
///
/// # Errors
///
/// Fails if `annotations` is not an array of `ZoteroAnnotationLocal` objects.
#[wasm_bindgen(js_name = zoteroWriteBackAnnotations)]
pub fn zotero_write_back_annotations_js(annotations: JsValue) -> JsResult<JsValue> {
    let annotations: Vec<ZoteroAnnotationLocal> = serde_wasm_bindgen::from_value(annotations)?;
    to_js(&zotero_write_back_annotations(&annotations))
}

/// [`zotero_write_back_message`]: the sync line's Zotero part for a summary, or `""` for null.
///
/// # Errors
///
/// Fails if `summary` is neither null nor a write-back summary object.
#[wasm_bindgen(js_name = zoteroWriteBackMessage)]
pub fn zotero_write_back_message_js(summary: JsValue) -> JsResult<String> {
    let summary: Option<WriteBackSummary> = serde_wasm_bindgen::from_value(summary)?;
    Ok(zotero_write_back_message(summary.as_ref()))
}
