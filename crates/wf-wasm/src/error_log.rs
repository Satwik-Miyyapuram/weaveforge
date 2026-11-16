//! Error-report log buffer for JavaScript (`wf_core::error_report::log_buffer`).
//!
//! The TS side keeps the buffer and the seen-set in variables and calls these to shape, trim and
//! de-duplicate them. Lines are not length-checked here: console output is already in memory.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::error_report::log_buffer;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`log_buffer::is_noise`] for JS: whether a failed request to `url` is left out of the log.
#[must_use]
#[wasm_bindgen(js_name = errorLogIsNoise)]
pub fn error_log_is_noise(url: &str) -> bool {
    log_buffer::is_noise(url)
}

/// [`log_buffer::console_line`] for JS: `[level] text`.
#[must_use]
#[wasm_bindgen(js_name = errorLogConsoleLine)]
pub fn error_log_console_line(level: &str, text: &str) -> String {
    log_buffer::console_line(level, text)
}

/// [`log_buffer::push_line`] for JS: the new line list, the oldest dropped past the cap.
///
/// # Errors
///
/// Fails when `lines` is not an array of strings.
#[wasm_bindgen(js_name = errorLogPushLine, unchecked_return_type = "unknown")]
pub fn error_log_push_line(
    #[wasm_bindgen(unchecked_param_type = "unknown")] lines: JsValue,
    line: &str,
) -> JsResult<JsValue> {
    let lines: Vec<String> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&log_buffer::push_line(lines, line.to_owned()))
}

/// [`log_buffer::record_uncaught`] for JS: the new line list with `[uncaught] text` appended.
///
/// # Errors
///
/// Fails when `lines` is not an array of strings.
#[wasm_bindgen(js_name = errorLogRecordUncaught, unchecked_return_type = "unknown")]
pub fn error_log_record_uncaught(
    #[wasm_bindgen(unchecked_param_type = "unknown")] lines: JsValue,
    text: &str,
) -> JsResult<JsValue> {
    let lines: Vec<String> = serde_wasm_bindgen::from_value(lines)?;
    to_js(&log_buffer::record_uncaught(lines, text))
}

/// [`log_buffer::error_entry`] for JS: `{ message, detail? }`.
///
/// # Errors
///
/// Fails when the entry cannot be converted to a JS value.
#[wasm_bindgen(js_name = errorLogEntry, unchecked_return_type = "unknown")]
pub fn error_log_entry(text: &str) -> JsResult<JsValue> {
    to_js(&log_buffer::error_entry(text))
}

/// [`log_buffer::remember`] for JS: `{ seen, recorded }`.
///
/// # Errors
///
/// Fails when `seen` is not an array of strings.
#[wasm_bindgen(js_name = errorLogRemember, unchecked_return_type = "unknown")]
pub fn error_log_remember(
    #[wasm_bindgen(unchecked_param_type = "unknown")] seen: JsValue,
    text: &str,
) -> JsResult<JsValue> {
    let seen: Vec<String> = serde_wasm_bindgen::from_value(seen)?;
    to_js(&log_buffer::remember(seen, text))
}
