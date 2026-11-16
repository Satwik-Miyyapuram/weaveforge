//! Log entry construction for JavaScript (wf-core `logbook::log_entry`). The JS names match
//! `packages/core/src/features/logbook/domain/parts.ts`.

use js_sys::{Error, Function, Reflect, TypeError};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::logbook::log_entry::{self, NewLogEntryInput};

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// `target[method]()` called on `target`, as a string.
fn call_for_string(target: &JsValue, method: &str) -> JsResult<String> {
    let function: Function = Reflect::get(target, &JsValue::from_str(method))?
        .dyn_into()
        .map_err(|_| TypeError::new(&format!("{method} is not a function")))?;
    function
        .call0(target)?
        .as_string()
        .ok_or_else(|| TypeError::new(&format!("{method}() must return a string")).into())
}

/// [`create_log_entry`](log_entry::create_log_entry): a valid log entry from partial input,
/// with defaults and invariants applied. The body is checked before `deps.clock.nowIso()`
/// and `deps.ids.newId()` run, in that order, like the TS original.
///
/// # Errors
///
/// Throws an `Error` named `LogEntryValidationError` when the input is invalid, and fails if
/// `input` has the wrong shape or a dependency cannot be called.
#[wasm_bindgen(js_name = createLogEntry, unchecked_return_type = "B.LogEntry")]
pub fn create_log_entry_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewLogEntryInput")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: &JsValue,
) -> JsResult<JsValue> {
    if let Some(message) = log_entry_input_error(input.clone())? {
        let error = Error::new(&message);
        error.set_name("LogEntryValidationError");
        return Err(error.into());
    }
    let now = call_for_string(&Reflect::get(deps, &JsValue::from_str("clock"))?, "nowIso")?;
    let id = call_for_string(&Reflect::get(deps, &JsValue::from_str("ids"))?, "newId")?;
    let input: NewLogEntryInput = serde_wasm_bindgen::from_value(input).map_err(JsValue::from)?;
    let entry = log_entry::create_log_entry(input, &id, &now)
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
