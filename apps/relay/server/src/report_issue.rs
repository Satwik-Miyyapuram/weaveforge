//! `POST /api/report-issue`: files the reader's error report as a GitHub issue.
//! Ported from apps/web/src/app/api/report-issue/route.ts.
//!
//! The reader's payload is redacted again here, because this is the last place
//! that decides what leaves the deployment.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER, USER_AGENT};
use axum::http::{HeaderMap, HeaderValue};
use axum::response::Response;
use serde_json::{Value, json};
use wf_core::error_report::redact::{MAX_REPORT_CHARS, redact_and_cap};

use crate::limiter::{Limit, RateLimiter};
use crate::routes::AppState;
use crate::sdk::{caller, error_response, json_response};

/// Five reports in a burst, then one an hour: generous for a person, useless as spam.
const REPORT_LIMIT: Limit = Limit {
    capacity: 5.0,
    refill_per_second: 1.0 / 720.0,
};
static REPORTS: LazyLock<RateLimiter> = LazyLock::new(|| RateLimiter::new(REPORT_LIMIT));

/// Field caps, before redaction, so a hostile body cannot be large in the first place.
const MAX_TITLE: usize = 200;
const MAX_DETAIL: usize = 20_000;
const MAX_LOGS: usize = 20_000;
const MAX_ROUTE: usize = 200;
const MAX_VERSION: usize = 60;

/// How long GitHub gets to answer before the report is reported as unreachable.
const TRACKER_TIMEOUT: Duration = Duration::from_secs(15);

/// `POST /api/report-issue`: redact the report and file it as an issue on the configured repository.
pub async fn report_issue(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    if let Err(retry_after) = REPORTS.take(&caller.user_id, Instant::now()) {
        return too_many(retry_after);
    }
    let parsed = match serde_json::from_slice::<Value>(&body) {
        Ok(parsed) => parsed,
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    let title = text(&parsed, "title", MAX_TITLE).trim();
    let detail = text(&parsed, "detail", MAX_DETAIL);
    if title.is_empty() || detail.is_empty() {
        return error_response(400, "A title and a description are required.");
    }
    let settings = &state.settings;
    let Some(token) = settings.issues_token.as_deref() else {
        return error_response(
            503,
            "Report filing is not configured on this deployment (GITHUB_ISSUES_TOKEN).",
        );
    };

    let payload = issue_payload(&parsed, title, detail);
    let created = match file_issue(&state, token, &payload).await {
        Ok(created) => created,
        Err(response) => return response,
    };
    json_response(
        200,
        &json!({
            "ok": true,
            "url": created.get("html_url").cloned().unwrap_or(Value::Null),
            "number": created.get("number").cloned().unwrap_or(Value::Null),
        }),
    )
}

/// The issue `{title, body}`: every field redacted and capped, the body laid out as the web route does.
fn issue_payload(parsed: &Value, title: &str, detail: &str) -> Value {
    let safe_title = redact_and_cap(title, MAX_TITLE);
    let safe_detail = redact_and_cap(detail, MAX_REPORT_CHARS);
    let safe_logs = redact_and_cap(text(parsed, "logs", MAX_LOGS), MAX_REPORT_CHARS);
    let route = redact_and_cap(text(parsed, "route", MAX_ROUTE), MAX_REPORT_CHARS).text;
    let version = redact_and_cap(text(parsed, "appVersion", MAX_VERSION), MAX_REPORT_CHARS).text;
    let redactions = safe_title.redactions + safe_detail.redactions + safe_logs.redactions;

    let mut places = Vec::new();
    if !route.is_empty() {
        places.push(format!("Route: `{route}`"));
    }
    if !version.is_empty() {
        places.push(format!("Version: `{version}`"));
    }
    let logs = safe_logs.text;
    let markdown = [
        "### What happened".to_owned(),
        String::new(),
        safe_detail.text,
        String::new(),
        if places.is_empty() {
            String::new()
        } else {
            format!("### Where\n\n{}", places.join(" · "))
        },
        if logs.is_empty() {
            String::new()
        } else {
            format!("### Recent errors and warnings\n\n```text\n{logs}\n```")
        },
        String::new(),
        "---".to_owned(),
        String::new(),
        format!(
            "Filed from the app's error screen. {redactions} item(s) were redacted automatically."
        ),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n");

    json!({"title": format!("[app] {}", safe_title.text), "body": markdown})
}

/// Posts the issue to the tracker; the created issue JSON, or the 502 to answer with.
async fn file_issue(state: &AppState, token: &str, payload: &Value) -> Result<Value, Response> {
    let settings = &state.settings;
    let url = format!(
        "{}/repos/{}/issues",
        settings.issues_api, settings.issues_repo
    );
    let sent = state
        .client
        .post(&url)
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(ACCEPT, "application/vnd.github+json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "weaveforge-error-report")
        .timeout(TRACKER_TIMEOUT)
        .body(serde_json::to_vec(payload).unwrap_or_default())
        .send()
        .await;
    let answer = match sent {
        Ok(answer) => answer,
        Err(err) => {
            eprintln!("[report-issue] tracker unreachable: {err}");
            return Err(error_response(
                502,
                "The issue tracker could not be reached.",
            ));
        }
    };
    if !answer.status().is_success() {
        eprintln!("[report-issue] tracker answered {}", answer.status());
        return Err(error_response(502, "The issue tracker refused the report."));
    }
    let created = match answer.bytes().await {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
        Err(err) => {
            eprintln!("[report-issue] tracker reply unreadable: {err}");
            return Err(error_response(
                502,
                "The issue tracker could not be reached.",
            ));
        }
    };
    Ok(created)
}

/// The string field `key` of the body, cut to `limit` UTF-16 units; "" when missing or not a string.
fn text<'a>(body: &'a Value, key: &str, limit: usize) -> &'a str {
    body.get(key)
        .and_then(Value::as_str)
        .map_or("", |value| utf16_prefix(value, limit))
}

/// The longest prefix of `value` within `limit` UTF-16 units, never splitting a character.
fn utf16_prefix(value: &str, limit: usize) -> &str {
    let mut units = 0;
    for (index, c) in value.char_indices() {
        units += c.len_utf16();
        if units > limit {
            return &value[..index];
        }
    }
    value
}

/// A 429 with `Retry-After` in whole seconds.
fn too_many(retry_after: u64) -> Response {
    let mut response = error_response(429, "Too many reports just now. Try again later.");
    if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
        let _ = response.headers_mut().insert(RETRY_AFTER, value);
    }
    response
}
