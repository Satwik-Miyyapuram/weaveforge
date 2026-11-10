//! Logbook list helpers for JavaScript (wf-core `logbook::log_view`). The TS wrappers in
//! `packages/wf-wasm/src/logbook-view.ts` apply the types.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::logbook::log_view::{
    group_by_day, log_eyebrow, newest_first_order, split_headline, streak_days,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`group_by_day`] for JS (TS `groupByDay`): `{ day, indexes }[]`, newest day first.
///
/// # Errors
///
/// Fails when `entryDates` is not an array of strings.
#[wasm_bindgen(js_name = groupByDay)]
pub fn group_by_day_js(entry_dates: JsValue) -> JsResult<JsValue> {
    let dates: Vec<String> = serde_wasm_bindgen::from_value(entry_dates)?;
    to_js(&group_by_day(&dates))
}

/// [`streak_days`] for JS (TS `streakDays`).
///
/// # Errors
///
/// Fails when `entryDates` is not an array of strings.
#[wasm_bindgen(js_name = streakDays)]
pub fn streak_days_js(entry_dates: JsValue, today: &str) -> JsResult<u32> {
    let dates: Vec<String> = serde_wasm_bindgen::from_value(entry_dates)?;
    Ok(streak_days(&dates, today))
}

/// [`log_eyebrow`] for JS (TS `logEyebrow`): the line, or `undefined` with no entries.
///
/// # Errors
///
/// Fails when `entryDates` is not an array of strings.
#[wasm_bindgen(js_name = logEyebrow)]
pub fn log_eyebrow_js(entry_dates: JsValue, today: &str) -> JsResult<JsValue> {
    let dates: Vec<String> = serde_wasm_bindgen::from_value(entry_dates)?;
    to_js(&log_eyebrow(&dates, today))
}

/// [`split_headline`] for JS (TS `splitHeadline`): `{ headline, rest }`.
#[wasm_bindgen(js_name = splitHeadline, unchecked_return_type = "B.LogHeadlineSplit")]
pub fn split_headline_js(body: &str) -> JsResult<JsValue> {
    to_js(&split_headline(body))
}

/// [`newest_first_order`] for JS (TS `newestFirstOrder`): indexes, latest stamp first.
///
/// # Errors
///
/// Fails when `publishedAt` is not an array of strings.
#[wasm_bindgen(js_name = newestFirstOrder)]
pub fn newest_first_order_js(published_at: JsValue) -> JsResult<JsValue> {
    let stamps: Vec<String> = serde_wasm_bindgen::from_value(published_at)?;
    to_js(&newest_first_order(&stamps))
}
