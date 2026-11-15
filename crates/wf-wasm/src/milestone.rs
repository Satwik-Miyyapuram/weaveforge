//! Milestone domain rules for JavaScript (wf-core `plan::milestone`). The JS names match
//! `packages/core/src/features/plan/domain/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::milestone::{self};


/// [`is_iso_day`](milestone::is_iso_day).
#[wasm_bindgen(js_name = isIsoDay)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn is_iso_day_js(value: String) -> bool {
    milestone::is_iso_day(&value)
}

/// [`iso_day_from_parts`](milestone::iso_day_from_parts): `month` is 1-based.
#[wasm_bindgen(js_name = isoDayFromParts)]
#[must_use]
pub fn iso_day_from_parts_js(year: i32, month: u32, day: u32) -> String {
    milestone::iso_day_from_parts(year, month, day)
}
