//! Plan feed for JavaScript (wf-core `plan::feed`): the iCalendar of dated milestones and the
//! widget summary.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::feed::{self, FeedMilestone};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`milestones_to_ics`](feed::milestones_to_ics): the `.ics` text for `items`.
///
/// # Errors
///
/// Fails if `items` has the wrong shape.
#[wasm_bindgen(js_name = milestonesToIcs)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "day counts and epoch milliseconds from JS are whole numbers well inside i64"
)]
pub fn milestones_to_ics_js(
    items: JsValue,
    include_done: bool,
    reminder_days: f64,
    now_ms: f64,
) -> JsResult<String> {
    let items: Vec<FeedMilestone> = serde_wasm_bindgen::from_value(items)?;
    Ok(feed::milestones_to_ics(
        &items,
        include_done,
        reminder_days as i64,
        now_ms as i64,
    ))
}

/// [`plan_widget`](feed::plan_widget): the summary a widget draws.
///
/// # Errors
///
/// Fails if `items` has the wrong shape.
#[wasm_bindgen(js_name = planWidgetData)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "epoch milliseconds from JS are whole numbers well inside i64"
)]
pub fn plan_widget_data_js(
    items: JsValue,
    include_done: bool,
    limit: Option<u32>,
    now_ms: f64,
) -> JsResult<JsValue> {
    let items: Vec<FeedMilestone> = serde_wasm_bindgen::from_value(items)?;
    let limit = limit.map(|n| n as usize);
    to_js(&feed::plan_widget(
        &items,
        include_done,
        limit,
        now_ms as i64,
    ))
}

/// [`add_days`](feed::add_days): `iso` moved by `days` calendar days.
///
/// # Errors
///
/// Throws if `iso` is not a real `yyyy-mm-dd` date.
#[wasm_bindgen(js_name = addDays)]
#[allow(
    clippy::cast_possible_truncation,
    reason = "a day offset from JS is a whole number well inside i64"
)]
pub fn add_days_js(iso: &str, days: f64) -> Result<String, JsValue> {
    feed::add_days(iso, days as i64)
        .ok_or_else(|| JsValue::from_str(&format!("Not a calendar date: {iso}")))
}
