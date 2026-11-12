//! Error-report redaction for JavaScript (`wf_core::error_report::redact`).
//!
//! Each redaction export returns `{ text, redactions }` (`B.Redacted`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::error_report::issue_url::{
    ReportMarkdown, new_issue_url as core_new_issue_url, report_markdown as core_report_markdown,
};
use wf_core::error_report::network_failure::is_network_failure as core_is_network_failure;
use wf_core::error_report::redact::{MAX_REPORT_CHARS, redact as core_redact, redact_and_cap};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`MAX_REPORT_CHARS`] for JS.
#[must_use]
#[wasm_bindgen(js_name = maxReportChars)]
pub fn max_report_chars() -> usize {
    MAX_REPORT_CHARS
}

/// [`wf_core::error_report::redact::redact`] for JS, as `{ text, redactions }`.
///
/// # Errors
///
/// Fails when `input` is over the text cap.
#[wasm_bindgen(js_name = redact, unchecked_return_type = "B.Redacted")]
pub fn redact_report(input: &str) -> JsResult<JsValue> {
    check_text(input)?;
    to_js(&core_redact(input))
}

/// [`wf_core::error_report::redact::redact_and_cap`] for JS, as `{ text, redactions }`.
/// `limit` is in UTF-16 units, floored and clamped at 0 (JS `ToUint32` of it, as the old TS
/// wrapper passed it); absent, it is [`MAX_REPORT_CHARS`].
///
/// # Errors
///
/// Fails when `input` is over the text cap.
#[wasm_bindgen(js_name = redactAndCap, unchecked_return_type = "B.Redacted")]
pub fn redact_report_and_cap(input: &str, limit: Option<f64>) -> JsResult<JsValue> {
    check_text(input)?;
    to_js(&redact_and_cap(input, report_cap(limit)))
}

/// The cap `redactAndCap` uses: `Math.max(0, Math.floor(limit))` converted the way
/// wasm-bindgen converts a JS number to `usize` (NaN and infinity give 0).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // Reduced below 2^32 first.
fn report_cap(limit: Option<f64>) -> usize {
    match limit {
        None => MAX_REPORT_CHARS,
        Some(limit) => {
            let limit = limit.floor().max(0.0);
            if limit.is_finite() {
                (limit % 4_294_967_296.0) as usize
            } else {
                0
            }
        }
    }
}

/// [`wf_core::error_report::issue_url::new_issue_url`] for JS: the address for
/// `body`, cut to fit the length limit.
///
/// # Errors
///
/// Fails when `title`, `body` or `repo` is over the text cap.
#[wasm_bindgen(js_name = newIssueUrl)]
pub fn new_issue_url(title: &str, body: &str, repo: &str) -> JsResult<String> {
    check_text(title)?;
    check_text(body)?;
    check_text(repo)?;
    Ok(core_new_issue_url(title, body, repo))
}

/// [`wf_core::error_report::report_repo::report_repo`] for JS: the configured
/// `owner/repo`, or the default when it is missing or malformed.
#[must_use]
#[wasm_bindgen(js_name = reportRepo)]
pub fn report_repo(configured: Option<String>) -> String {
    wf_core::error_report::report_repo::report_repo(configured.as_deref())
}

/// [`wf_core::error_report::issue_url::report_markdown`] for JS.
///
/// # Errors
///
/// Fails when `input` is not a valid `ReportMarkdown` object, or its text is over the cap.
#[wasm_bindgen(js_name = reportMarkdown)]
pub fn report_markdown(
    #[wasm_bindgen(unchecked_param_type = "B.ReportMarkdown")] input: JsValue,
) -> JsResult<String> {
    let input: ReportMarkdown = serde_wasm_bindgen::from_value(input)?;
    check_text(&input.detail)?;
    if let Some(logs) = &input.logs {
        check_text(logs)?;
    }
    Ok(core_report_markdown(&input))
}

/// [`wf_core::error_report::network_failure::is_network_failure`] for JS.
///
/// # Errors
///
/// Fails when `message` is over the text cap.
#[wasm_bindgen(js_name = isNetworkFailure)]
pub fn is_network_failure(message: &str) -> JsResult<bool> {
    check_text(message)?;
    Ok(core_is_network_failure(message))
}
