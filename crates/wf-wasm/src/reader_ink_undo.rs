//! Reader ink undo stack for JavaScript (wf-core `reader::ink_undo`). Each export wraps a
//! `wf_core::reader::ink_undo` function; the JS shapes match `packages/core/src/reader/ink-undo.ts`.
//!
//! The stacks cross as plain objects through serde; a missing step is `null`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::ink_undo::{self, InkUndoEntry, InkUndoState};
use wf_core::reader::zotero_sync::ZoteroAnnotationLocal;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`push_ink_undo`](ink_undo::push_ink_undo).
///
/// # Errors
///
/// Fails if `state` or `entry` has the wrong shape.
#[wasm_bindgen(js_name = pushInkUndo, unchecked_return_type = "B.InkUndoState")]
pub fn push_ink_undo_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkUndoState")] state: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.InkUndoEntry")] entry: JsValue,
) -> JsResult<JsValue> {
    let state: InkUndoState = serde_wasm_bindgen::from_value(state)?;
    let entry: InkUndoEntry = serde_wasm_bindgen::from_value(entry)?;
    to_js(&ink_undo::push_ink_undo(&state, entry))
}

/// [`take_ink_undo`](ink_undo::take_ink_undo); `null` when there is no step.
///
/// # Errors
///
/// Fails if `state` has the wrong shape.
#[wasm_bindgen(js_name = takeInkUndo)]
pub fn take_ink_undo_js(state: JsValue) -> JsResult<JsValue> {
    let state: InkUndoState = serde_wasm_bindgen::from_value(state)?;
    match ink_undo::take_ink_undo(&state) {
        Some(step) => to_js(&step),
        None => Ok(JsValue::NULL),
    }
}

/// [`take_ink_redo`](ink_undo::take_ink_redo); `null` when there is no step.
///
/// # Errors
///
/// Fails if `state` has the wrong shape.
#[wasm_bindgen(js_name = takeInkRedo)]
pub fn take_ink_redo_js(state: JsValue) -> JsResult<JsValue> {
    let state: InkUndoState = serde_wasm_bindgen::from_value(state)?;
    match ink_undo::take_ink_redo(&state) {
        Some(step) => to_js(&step),
        None => Ok(JsValue::NULL),
    }
}

/// [`rename_ink_undo_id`](ink_undo::rename_ink_undo_id).
///
/// # Errors
///
/// Fails if `state` has the wrong shape.
#[wasm_bindgen(js_name = renameInkUndoId, unchecked_return_type = "B.InkUndoState")]
pub fn rename_ink_undo_id_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkUndoState")] state: JsValue,
    from: &str,
    to: &str,
) -> JsResult<JsValue> {
    let state: InkUndoState = serde_wasm_bindgen::from_value(state)?;
    to_js(&ink_undo::rename_ink_undo_id(&state, from, to))
}

/// [`refresh_ink_undo_annotation`](ink_undo::refresh_ink_undo_annotation).
///
/// # Errors
///
/// Fails if `state` or `annotation` has the wrong shape.
#[wasm_bindgen(js_name = refreshInkUndoAnnotation, unchecked_return_type = "B.InkUndoState")]
pub fn refresh_ink_undo_annotation_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkUndoState")] state: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ReaderAnnotation")] annotation: JsValue,
) -> JsResult<JsValue> {
    let state: InkUndoState = serde_wasm_bindgen::from_value(state)?;
    let annotation: ZoteroAnnotationLocal = serde_wasm_bindgen::from_value(annotation)?;
    to_js(&ink_undo::refresh_ink_undo_annotation(&state, &annotation))
}
