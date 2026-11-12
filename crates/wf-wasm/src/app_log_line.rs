//! Application log line formatting for JavaScript (wf-core `app_log_line`). The JS name matches
//! `apps/desktop/src/main-app-log.ts`.

use serde::Deserialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::app_log_line::format_log_line;

/// The fields of one log entry that a line is made from (TS `AppLogLineInput`). Other fields
/// on the caller's entry are ignored.
#[derive(Deserialize)]
struct AppLogLineInput {
    at: String,
    level: String,
    source: String,
    message: String,
    #[serde(default)]
    detail: Option<String>,
}

/// [`format_log_line`]: one log entry as the text the panel and the log file both show.
///
/// # Errors
///
/// Fails if `entry` lacks one of the string fields.
#[wasm_bindgen(js_name = formatLogLine)]
pub fn format_log_line_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ at: string; level: string; source: string; message: string; detail?: string }"
    )]
    entry: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let entry: AppLogLineInput = serde_wasm_bindgen::from_value(entry)?;
    Ok(format_log_line(
        &entry.at,
        &entry.level,
        &entry.source,
        &entry.message,
        entry.detail.as_deref(),
    ))
}
