//! Plan feed for JavaScript (wf-core `plan::feed`): the iCalendar of dated milestones and the
//! widget summary.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::feed::{self};
use wf_core::plan::feed_urls;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The options object the feed exports take; unset fields take the defaults (`false`, `0`).
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedOptions {
    include_done: Option<bool>,
    reminder_days: Option<f64>,
}

/// `options` as [`FeedOptions`]; `undefined` and `null` mean the defaults.
fn feed_options(options: &JsValue) -> JsResult<FeedOptions> {
    if options.is_undefined() || options.is_null() {
        return Ok(FeedOptions::default());
    }
    serde_wasm_bindgen::from_value(options.clone())
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

/// [`plan_feed_origin`](feed_urls::plan_feed_origin): where the calendar feed is served.
#[wasm_bindgen(js_name = planFeedOrigin)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn plan_feed_origin_js(
    server_routes: bool,
    here: Option<String>,
    configured: Option<String>,
) -> String {
    feed_urls::plan_feed_origin(server_routes, here.as_deref(), configured.as_deref())
}

/// [`plan_feed_urls`](feed_urls::plan_feed_urls): the calendar, https and widget links for `token`.
/// `includeDone` defaults to `false` and `reminderDays` to `0`.
///
/// # Errors
///
/// Fails if `options` has the wrong shape.
#[wasm_bindgen(js_name = planFeedUrls, unchecked_return_type = "B.PlanFeedUrls")]
pub fn plan_feed_urls_js(
    origin: &str,
    token: &str,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ includeDone?: boolean; reminderDays?: number }"
    )]
    options: Option<JsValue>,
) -> JsResult<JsValue> {
    let opts = feed_options(&options.unwrap_or(JsValue::UNDEFINED))?;
    to_js(&feed_urls::plan_feed_urls(
        origin,
        token,
        opts.include_done.unwrap_or(false),
        opts.reminder_days.unwrap_or(0.0),
    ))
}
