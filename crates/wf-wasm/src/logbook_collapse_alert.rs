//! Citation-alert short form for JavaScript (wf-core `logbook::collapse_alert`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::logbook::collapse_alert::collapse_alert;

use super::to_js;

/// [`collapse_alert`]: the short form of a citation alert as `{ shown, hidden }`, or
/// `null` when the entry is not a long citation alert.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = collapseAlert, unchecked_return_type = "B.CollapsedAlert | null")]
pub fn collapse_alert_js(headline: &str, rest: &str) -> Result<JsValue, wasm_bindgen::JsError> {
    let collapsed = collapse_alert(headline, rest);
    to_js(&collapsed).map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}
