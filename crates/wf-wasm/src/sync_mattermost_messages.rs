//! The Mattermost message builders for JavaScript (wf-core `sync::mattermost_messages`). The JS
//! names `milestoneMessage`, `citationAlertMessage` and `logEntryMessage` are wrapped by
//! `packages/wf-wasm/src/mattermost-messages.ts`, which `features/sync/infrastructure/mattermost-notifier.ts` calls.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::mattermost_messages::{
    CitationAlertInput, LogEntryMessageInput, MilestoneMessageInput, citation_alert_message,
    log_entry_message, milestone_message,
};

type JsResult<T> = Result<T, Error>;

/// [`milestone_message`] for JS (TS `milestoneMessage`).
///
/// # Errors
///
/// Fails when `input` is not a milestone message input with the expected fields.
#[wasm_bindgen(js_name = milestoneMessage)]
pub fn milestone_message_js(input: JsValue) -> JsResult<String> {
    let input: MilestoneMessageInput = serde_wasm_bindgen::from_value(input)?;
    Ok(milestone_message(&input))
}

/// [`citation_alert_message`] for JS (TS `citationAlertMessage`).
///
/// # Errors
///
/// Fails when `input` is not a citation alert input with the expected fields.
#[wasm_bindgen(js_name = citationAlertMessage)]
pub fn citation_alert_message_js(input: JsValue) -> JsResult<String> {
    let input: CitationAlertInput = serde_wasm_bindgen::from_value(input)?;
    Ok(citation_alert_message(&input))
}

/// [`log_entry_message`] for JS (TS `logEntryMessage`).
///
/// # Errors
///
/// Fails when `input` is not a log entry message input with the expected fields.
#[wasm_bindgen(js_name = logEntryMessage)]
pub fn log_entry_message_js(input: JsValue) -> JsResult<String> {
    let input: LogEntryMessageInput = serde_wasm_bindgen::from_value(input)?;
    Ok(log_entry_message(&input))
}
