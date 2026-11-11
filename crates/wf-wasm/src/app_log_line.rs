//! Application log line formatting for JavaScript (wf-core `app_log_line`). JS name matches
//! `packages/wf-wasm/src/wrappers-1.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::app_log_line::format_log_line;

/// [`format_log_line`]: one log entry as the text the panel and the log file both show.
#[wasm_bindgen(js_name = formatLogLine)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn format_log_line_js(
    at: &str,
    level: &str,
    source: &str,
    message: &str,
    detail: Option<String>,
) -> String {
    format_log_line(at, level, source, message, detail.as_deref())
}
