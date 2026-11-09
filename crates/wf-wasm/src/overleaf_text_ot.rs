//! ShareJS text ops for JavaScript (wf-core `overleaf::text_ot`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::overleaf::text_ot::{self, TextOp};

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// [`apply_op`](text_ot::apply_op): `text` with `op` applied.
///
/// # Errors
///
/// Fails when the op does not fit the text, or the op cannot be read.
#[wasm_bindgen(js_name = applyTextOp)]
pub fn apply_text_op_js(text: &str, op: JsValue) -> JsResult<String> {
    let op: TextOp = serde_wasm_bindgen::from_value(op).map_err(JsValue::from)?;
    text_ot::apply_op(text, &op).map_err(|message| JsValue::from_str(&message))
}

/// [`transform_x`](text_ot::transform_x): `[ours, theirs]` rewritten to apply after each other.
///
/// # Errors
///
/// Fails when the ops cannot be read or two overlapping deletes disagree.
#[wasm_bindgen(js_name = transformTextOps)]
pub fn transform_text_ops_js(left: JsValue, right: JsValue) -> JsResult<JsValue> {
    let left: TextOp = serde_wasm_bindgen::from_value(left).map_err(JsValue::from)?;
    let right: TextOp = serde_wasm_bindgen::from_value(right).map_err(JsValue::from)?;
    let (left, right) =
        text_ot::transform_x(&left, &right).map_err(|message| JsValue::from_str(&message))?;
    to_js(&(left, right)).map_err(JsValue::from)
}
