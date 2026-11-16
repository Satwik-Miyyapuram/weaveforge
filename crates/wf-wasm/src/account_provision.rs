//! Create-user reply decision and citation-alert failure log line for JavaScript (wf-core `account_provision`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::account_provision;

use super::to_js;

/// [`create_member_reply`](account_provision::create_member_reply): created, or rejected with the fallback text.
///
/// # Errors
///
/// Fails if the reply cannot be converted to a JS value.
#[wasm_bindgen(js_name = createMemberReply, unchecked_return_type = "{ kind: 'created' } | { kind: 'rejected'; fallback: string }")]
pub fn create_member_reply_js(
    ok: bool,
    has_member: bool,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&account_provision::create_member_reply(ok, has_member))
}

/// [`citation_alert_failure_log`](account_provision::citation_alert_failure_log) as a JS object.
///
/// # Errors
///
/// Fails if the log line cannot be converted to a JS value.
#[wasm_bindgen(js_name = citationAlertFailureLog, unchecked_return_type = "{ level: 'warn'; source: string; message: string; detail: string }")]
pub fn citation_alert_failure_log_js(
    paper_id: &str,
    reason: &str,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&account_provision::citation_alert_failure_log(
        paper_id, reason,
    ))
}
