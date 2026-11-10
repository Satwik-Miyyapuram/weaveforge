//! The ink recognition request check for JavaScript (wf-core `ink::recognition_request`). The JS
//! name matches `apps/desktop/src/ink-recogniser.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::recognition_request::read_ink_request;

use super::to_js;

/// [`read_ink_request`]: the page's request checked whole, or `null` when it is malformed.
/// Never throws, as the TS did not: input that is not convertible to JSON is `null` too.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = readInkRequest)]
pub fn read_ink_request_js(request: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let value: Option<serde_json::Value> = serde_wasm_bindgen::from_value(request).ok();
    let read = value.as_ref().and_then(read_ink_request);
    to_js(&read)
}
