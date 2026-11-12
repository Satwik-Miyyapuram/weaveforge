//! ShareJS text ops for JavaScript (wf-core `overleaf::text_ot`). Every failure is thrown as an
//! `Error`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::overleaf::text_ot::{self, TextOp};

use super::to_js;

/// [`apply_op`](text_ot::apply_op): `text` with `op` applied.
///
/// # Errors
///
/// Fails when a delete does not match the text it removes, or the op cannot be read.
#[wasm_bindgen(js_name = applyTextOp)]
pub fn apply_text_op_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.TextComponent[]")] op: JsValue,
) -> Result<String, JsError> {
    let op: TextOp =
        serde_wasm_bindgen::from_value(op).map_err(|error| JsError::new(&error.to_string()))?;
    text_ot::apply_op(text, &op).map_err(|error| JsError::new(&error.to_string()))
}

/// [`transform_x`](text_ot::transform_x): `[ours, theirs]` rewritten to apply after each other.
/// `left` is ours, `right` the server's.
///
/// # Errors
///
/// Fails when the ops cannot be read or two overlapping deletes disagree.
#[wasm_bindgen(
    js_name = transformTextOps,
    unchecked_return_type = "[B.TextComponent[], B.TextComponent[]]"
)]
pub fn transform_text_ops_js(
    #[wasm_bindgen(unchecked_param_type = "B.TextComponent[]")] left: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.TextComponent[]")] right: JsValue,
) -> Result<JsValue, JsError> {
    let left: TextOp =
        serde_wasm_bindgen::from_value(left).map_err(|error| JsError::new(&error.to_string()))?;
    let right: TextOp =
        serde_wasm_bindgen::from_value(right).map_err(|error| JsError::new(&error.to_string()))?;
    let (left, right) =
        text_ot::transform_x(&left, &right).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&(left, right)).map_err(|error| JsError::new(&error.to_string()))
}
