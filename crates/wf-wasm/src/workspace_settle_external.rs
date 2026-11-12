//! Settling the outside-edit list after a preview (wf-core `workspace::settle_external`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::settle_external::{self, SettleInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`settle_external`](settle_external::settle_external) on
/// `{ entries, reasons, only, external, externalReasons }`, returning
/// `{ external, externalReasons }`.
///
/// # Errors
///
/// Fails if the input does not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = settleExternal, unchecked_return_type = "{ external: string[]; externalReasons: Record<string, B.HeldReason> }")]
pub fn settle_external_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ entries: { action: B.ImportAction; path: string }[]; reasons: Readonly<Record<string, B.HeldReason>>; only?: readonly string[] | null; external: readonly string[]; externalReasons: Readonly<Record<string, B.HeldReason>> }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: SettleInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&settle_external::settle_external(&input))
}
