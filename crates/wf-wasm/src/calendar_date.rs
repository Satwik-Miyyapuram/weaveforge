//! wasm exports for calendar-date text (wf-core `calendar_date`). The JS names match
//! `packages/core/src/shared/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::calendar_date;

/// [`iso_date`](calendar_date::iso_date): the calendar part of an ISO timestamp.
#[wasm_bindgen(js_name = isoDate)]
#[must_use]
pub fn iso_date_js(iso: &str) -> String {
    calendar_date::iso_date(iso)
}

/// [`local_iso_date`](calendar_date::local_iso_date): `YYYY-MM-DD` from local fields (month 1-based).
#[wasm_bindgen(js_name = localIsoDate)]
#[must_use]
pub fn local_iso_date_js(year: i32, month: u32, day: u32) -> String {
    calendar_date::local_iso_date(year, month, day)
}
