//! The ink tuning constants ([`wf_core::ink::constants`]), read by
//! `packages/core/src/ink/*.ts` through `rust()` at call time. One object, so
//! the TS side makes a single call.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::constants::ink_constants as core_ink_constants;

use super::to_js;

/// The ink tuning constants as one object.
///
/// # Errors
///
/// Fails only if the object cannot be serialised.
#[wasm_bindgen(js_name = inkConstants, unchecked_return_type = "B.InkConstants")]
pub fn ink_constants() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&core_ink_constants())
}
