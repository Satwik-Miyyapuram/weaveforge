//! Error-report redaction for JavaScript (`wf_core::error_report::redact`).
//!
//! Each export returns `{ text, redactions }`; the TS wrapper in
//! `packages/wf-wasm/src/error-report.ts` names the type.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::error_report::issue_url::{
    ReportMarkdown, new_issue_url as core_new_issue_url, report_markdown as core_report_markdown,
};
use wf_core::error_report::network_failure::is_network_failure as core_is_network_failure;
use wf_core::error_report::redact::{MAX_REPORT_CHARS, redact as core_redact, redact_and_cap};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`MAX_REPORT_CHARS`] for JS, so the wrapper's default cap matches Rust.
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
#[wasm_bindgen(js_name = redactReport, unchecked_return_type = "B.Redacted")]
pub fn redact_report(input: &str) -> JsResult<JsValue> {
    check_text(input)?;
    to_js(&core_redact(input))
}

/// [`wf_core::error_report::redact::redact_and_cap`] for JS, as `{ text, redactions }`.
/// `limit` is in UTF-16 units.
///
/// # Errors
///
/// Fails when `input` is over the text cap.
#[wasm_bindgen(js_name = redactReportAndCap, unchecked_return_type = "B.Redacted")]
pub fn redact_report_and_cap(input: &str, limit: usize) -> JsResult<JsValue> {
    check_text(input)?;
    to_js(&redact_and_cap(input, limit))
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
