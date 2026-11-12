//! wasm exports for the UI date formats in `wf_core::date_format`. Each takes the
//! local UTC offset in minutes (`-Date.getTimezoneOffset()`) because Rust has no
//! time-zone database.

use wasm_bindgen::prelude::*;

/// "1 Jul 2026" for an ISO date or datetime, `""` when it does not parse.
#[wasm_bindgen(js_name = formatDate)]
#[must_use]
pub fn format_date(input: &str, offset_minutes: i32) -> String {
    wf_core::date_format::format_date(input, offset_minutes)
}

/// "1 Jul 2026, 14:05" for an ISO datetime, `""` when it does not parse.
#[wasm_bindgen(js_name = formatDateTime)]
#[must_use]
pub fn format_date_time(input: &str, offset_minutes: i32) -> String {
    wf_core::date_format::format_date_time(input, offset_minutes)
}

/// "Just now", "5m ago", "2h ago", "3d ago", or the date, relative to `now_iso`.
#[wasm_bindgen(js_name = formatRelative)]
#[must_use]
pub fn format_relative(input: &str, now_iso: &str, offset_minutes: i32) -> String {
    wf_core::date_format::format_relative(input, now_iso, offset_minutes)
}
