//! Mark popover decisions for JavaScript (`apps/web/src/features/reader/application/mark-actions.ts`).
//! Wraps `wf_core::reader::mark_actions`.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::mark_actions::{MarkTarget, mark_actions, mark_popover_shown, picture_path};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`mark_actions`]: what the popover on a tapped mark offers, or `null` when it offers nothing.
///
/// # Errors
///
/// Fails if `target` is not a mark's `{ type, origin, comment }` object.
#[wasm_bindgen(js_name = markActions, unchecked_return_type = "B.MarkActions | null")]
pub fn mark_actions_js(
    #[wasm_bindgen(unchecked_param_type = "B.MarkTarget")] target: JsValue,
) -> JsResult<JsValue> {
    let target: MarkTarget = serde_wasm_bindgen::from_value(target)?;
    to_js(&mark_actions(&target))
}

/// The one field of a mark the popover-visibility rule reads.
#[derive(Deserialize)]
struct MarkType {
    #[serde(rename = "type")]
    kind: String,
}

/// [`mark_popover_shown`]: whether a mark's popover shows under the current tool.
///
/// # Errors
///
/// Fails if `annotation` has no string `type`.
#[wasm_bindgen(js_name = markPopoverShown)]
pub fn mark_popover_shown_js(
    #[wasm_bindgen(unchecked_param_type = "Pick<B.MarkTarget, \"type\">")] annotation: JsValue,
    tool: &str,
) -> JsResult<bool> {
    let annotation: MarkType = serde_wasm_bindgen::from_value(annotation)?;
    Ok(mark_popover_shown(&annotation.kind, tool))
}

/// [`picture_path`]: the stored file behind a placed picture, or `null`.
///
/// # Errors
///
/// Fails if `target` is not a mark's `{ type, origin, comment }` object.
#[wasm_bindgen(js_name = picturePath, unchecked_return_type = "string | null")]
pub fn picture_path_js(
    #[wasm_bindgen(unchecked_param_type = "B.MarkTarget")] target: JsValue,
) -> JsResult<JsValue> {
    let target: MarkTarget = serde_wasm_bindgen::from_value(target)?;
    to_js(&picture_path(&target))
}
