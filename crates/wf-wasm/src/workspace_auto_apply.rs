//! Auto-apply wait for JavaScript (wf-core `workspace::auto_apply`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::auto_apply::{self, AutoApplyInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`auto_apply_timing`](auto_apply::auto_apply_timing) on
/// `{ now, firstAt, debounceMs, maxWaitMs }`, returning `{ delay, firstAt }`.
///
/// # Errors
///
/// Fails if the input does not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = autoApplyTiming, unchecked_return_type = "{ delay: number; firstAt: number }")]
pub fn auto_apply_timing_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ now: number; firstAt: number | null; debounceMs: number; maxWaitMs: number }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: AutoApplyInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&auto_apply::auto_apply_timing(&input))
}
