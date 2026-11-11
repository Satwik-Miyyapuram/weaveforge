//! Log entry construction for JavaScript (wf-core `logbook::log_entry`). The JS names match
//! `packages/core/src/features/logbook/domain/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::logbook::log_entry::{self, NewLogEntryInput};

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// [`create_log_entry`](log_entry::create_log_entry). `id` and `now` come from the TS clock and
/// id generator, which the caller runs before this call.
///
/// # Errors
///
/// Fails if `input` has the wrong shape, or the body is blank after trimming.
#[wasm_bindgen(js_name = createLogEntry)]
pub fn create_log_entry_js(input: JsValue, id: &str, now: &str) -> JsResult<JsValue> {
    let input: NewLogEntryInput = serde_wasm_bindgen::from_value(input).map_err(JsValue::from)?;
    let entry = log_entry::create_log_entry(input, id, now)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    to_js(&entry).map_err(JsValue::from)
}

/// [`validate_new_log_entry`](log_entry::validate_new_log_entry): the error message, or `None`.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = logEntryInputError)]
pub fn log_entry_input_error(
    #[wasm_bindgen(unchecked_param_type = "B.NewLogEntryInput")] input: JsValue,
) -> JsResult<Option<String>> {
    let input: NewLogEntryInput = serde_wasm_bindgen::from_value(input).map_err(JsValue::from)?;
    Ok(log_entry::validate_new_log_entry(&input)
        .err()
        .map(|e| e.to_string()))
}
