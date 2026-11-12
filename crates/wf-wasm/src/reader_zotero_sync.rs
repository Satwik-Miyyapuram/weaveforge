//! Zotero write-back decisions, field diffs, conflict merges and payloads for JavaScript.
//! Each export wraps a `wf_core::reader::zotero_sync` function; the JS shapes match
//! `packages/core/src/reader/zotero-write-back.ts`.

use js_sys::Array;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::zotero_sync::{
    ZoteroAnnotationLocal, ZoteroAnnotationSyncRow, ZoteroSyncLibraryMode, decide_annotation_sync,
    diff_annotation_fields, is_zotero_library_sync_mode, resolve_annotation_conflict,
    to_zotero_write_payload, zotero_write_back_annotations,
};

use wf_core::reader::zotero_write_back_message::{
    ZoteroWriteBackSummary, zotero_write_back_message,
};

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
#[wasm_bindgen(js_name = decideAnnotationSync, unchecked_return_type = "B.ZoteroAnnotationDecision")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn decide_annotation_sync_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroAnnotationSyncRow")] row: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "\"bidirectional\" | \"read_only\" | \"ignored\" | undefined"
    )]
    mode: Option<String>,
) -> JsResult<JsValue> {
    let row: ZoteroAnnotationSyncRow = serde_wasm_bindgen::from_value(row)?;
    // A missing mode acts as `bidirectional`, as `""` does.
    to_js(&decide_annotation_sync(
        &row,
        ZoteroSyncLibraryMode::from_js(mode.as_deref().unwrap_or("")),
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

#[wasm_bindgen(typescript_custom_section)]
const ZOTERO_WRITE_BACK_ANNOTATIONS_TS: &str = r#"
/**
 * The annotations a write-back sends: everything but ink, and only those with a
 * PDF page. The caller's own objects come back, in order.
 */
export function zoteroWriteBackAnnotations<T extends B.ZoteroAnnotationLocal>(annotations: readonly T[]): T[];
"#;

/// [`zotero_write_back_annotations`]: the caller's annotation objects a write-back sends, in order.
/// Typed by the custom section above, since its TS signature is generic.
///
/// # Errors
///
/// Fails if `annotations` is not an array of `ZoteroAnnotationLocal` objects.
#[wasm_bindgen(js_name = zoteroWriteBackAnnotations, skip_typescript)]
pub fn zotero_write_back_annotations_js(annotations: JsValue) -> JsResult<JsValue> {
    let originals = Array::from(&annotations);
    let parsed: Vec<ZoteroAnnotationLocal> = serde_wasm_bindgen::from_value(annotations)?;
    Ok(pick(&originals, zotero_write_back_annotations(&parsed)))
}

/// The entries of `originals` at `indices`, in that order, as a new array.
fn pick(originals: &Array, indices: impl IntoIterator<Item = usize>) -> JsValue {
    indices
        .into_iter()
        .filter_map(|i| u32::try_from(i).ok())
        .map(|i| originals.get(i))
        .collect::<Array>()
        .into()
}

/// [`zotero_write_back_message`]: the sync line's Zotero part for a summary, or `""` for null.
///
/// # Errors
///
/// Fails if `summary` is neither null nor a write-back summary object.
#[wasm_bindgen(js_name = zoteroWriteBackMessage)]
pub fn zotero_write_back_message_js(
    #[wasm_bindgen(unchecked_param_type = "B.ZoteroWriteBackSummary | null")] summary: JsValue,
) -> JsResult<String> {
    let summary: Option<ZoteroWriteBackSummary> = serde_wasm_bindgen::from_value(summary)?;
    Ok(zotero_write_back_message(summary.as_ref()))
}
