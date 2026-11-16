//! Error-boundary detail text for JavaScript (`wf_core::error_report::detail`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::error_report::detail::error_detail as core_error_detail;

/// [`wf_core::error_report::detail::error_detail`] for JS: the message, digest and stack, one per
/// line. The caller reads the fields off the thrown `Error` and passes them; absent ones are
/// `undefined`.
#[must_use]
#[wasm_bindgen(js_name = errorDetail)]
pub fn error_detail(
    message: Option<String>,
    digest: Option<String>,
    stack: Option<String>,
) -> String {
    core_error_detail(message.as_deref(), digest.as_deref(), stack.as_deref())
}
