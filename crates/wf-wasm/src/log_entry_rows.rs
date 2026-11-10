//! Log-entry row mapping for JavaScript (wf-core `logbook::log_entry_row`). The TS wrapper in
//! `packages/wf-wasm/src/log-entry-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::logbook::log_entry::LogEntry;
use wf_core::logbook::log_entry_row::{LogEntryRow, to_domain, to_row};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_domain`]: a `log_entries` row as a domain entry.
#[wasm_bindgen(js_name = logEntryToDomain)]
pub fn log_entry_to_domain_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: LogEntryRow = parse(row)?;
    to_js(&to_domain(&row)).map_err(js_error)
}

/// [`to_row`]: a domain entry as the `log_entries` row it is written as.
#[wasm_bindgen(js_name = logEntryToRow)]
pub fn log_entry_to_row_js(entry: JsValue) -> Result<JsValue, JsError> {
    let entry: LogEntry = parse(entry)?;
    to_js(&to_row(&entry)).map_err(js_error)
}
