//! The ink recognition request check for JavaScript (wf-core `ink::recognition_request`). The JS
//! name matches `apps/desktop/src/ink-recogniser.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::recognition_request::{InkRequestBuildInput, build_ink_request};

use super::to_js;

/// [`build_ink_request`]: the page's lines and hints turned into the helper's request.
///
/// # Errors
///
/// Fails when the input is not the page's shape, or the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = buildInkRequest, unchecked_return_type = "B.InkRecognitionRequest")]
pub fn build_ink_request_js(
    #[wasm_bindgen(unchecked_param_type = "B.InkRequestBuildInput")] input: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: InkRequestBuildInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&build_ink_request(&input))
}
