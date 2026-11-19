//! The plan feed route: `deadlines.ics` for a calendar, `widget.json` for widgets.
//! Port of `apps/web/src/app/api/plan/feed/[token]/[file]/route.ts`.
//!
//! Two token kinds reach the same renderer:
//! - Legacy tokens (anything not `wff_`) read the live milestones tables.
//! - `wff_` tokens read the feed row that `POST /api/plan/feed/publish` wrote, so
//!   the calendar keeps working while the desktop app is off.
//!
//! Laws:
//! 1. The raw `wff_` token is never sent upstream or logged; only its SHA-256 is.
//! 2. Rotation is publishing with a new token; the old link finds no row and 404s.
//! 3. Publish is session-only and refuses another owner's feed with 403.
//! 4. An unknown or revoked link answers 404, never 401.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::extract::{Path, Query, State};
use axum::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, AUTHORIZATION, CONTENT_DISPOSITION};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use wf_core::bytea::{decode_bytea, encode_bytea};
use wf_core::plan::feed::{FeedMilestone, milestones_to_ics, plan_widget_data};

use crate::auth::{Caller, require_plan_feed, require_session, token_hash_hex};
use crate::postgrest::{UserDb, eq};
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, json_response, user_db};

const ICS_FILE: &str = "deadlines.ics";
const WIDGET_FILE: &str = "widget.json";
const ICS_TYPE: &str = "text/calendar; charset=utf-8";
const JSON_TYPE: &str = "application/json; charset=utf-8";
const MILESTONE_COLUMNS: &str =
    "id,title,description,status,target_date,dependencies,compute,created_at,project_id";
const MAX_ALARM_DAYS: i64 = 30;
/// Prefix of a published feed token.
const FEED_PREFIX: &str = "wff_";
const FEED_SECRET_MIN: usize = 32;
const FEED_SECRET_MAX: usize = 64;
const FEED_ID_MAX: usize = 64;
/// Largest publish body, in bytes.
const PUBLISH_LIMIT: usize = 1024 * 1024;
const SHARED_DOCS: &str = "shared_docs";

/// The stored feed document: the milestones the calendar and widget render.
#[derive(Debug, Serialize, Deserialize)]
struct FeedDoc {
    items: Vec<FeedMilestone>,
}

/// The body of `POST /api/plan/feed/publish`.
#[derive(Debug, Deserialize)]
struct PublishRequest {
    feed_id: String,
    token: String,
    items: Vec<FeedMilestone>,
}

/// `GET /api/plan/feed/{token}/{file}`: the owner's plan as a calendar or a widget document.
pub async fn plan_feed(
    State(state): State<Arc<AppState>>,
    Path((token, file)): Path<(String, String)>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let is_ics = match file.as_str() {
        ICS_FILE => true,
        WIDGET_FILE => false,
        _ => return error_response(404, "Not found."),
    };
    let items = if is_feed_token(&token) {
        published_items(&state, &token).await
    } else {
        legacy_items(&state, &token).await
    };
    match items {
        Ok(items) => render(&items, is_ics, &params),
        Err(response) => response,
    }
}

/// `POST /api/plan/feed/publish`: store the caller's feed under a new token.
/// The row keeps only the token's hash; publishing again with a new token
/// replaces the hash, so the old link 404s.
pub async fn publish(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let caller = match require_session(&state.client, &state.config, authorization).await {
        Ok(caller) => caller,
        Err(err) => return error_response(err.status, &err.message),
    };
    let bytes = match to_bytes(body, PUBLISH_LIMIT).await {
        Ok(bytes) => bytes,
        Err(_) => return error_response(413, "Payload too large."),
    };
    let request: PublishRequest = match serde_json::from_slice(&bytes) {
        Ok(request) => request,
        Err(_) => return error_response(400, "Invalid feed body."),
    };
    if !is_feed_id(&request.feed_id) || !is_feed_token(&request.token) {
        return error_response(400, "Invalid feed id or token.");
    }

    let db = service_db(&state);
    match db
        .select(
            SHARED_DOCS,
            &[
                ("select", "owner".to_owned()),
                ("item_id", eq(&request.feed_id)),
            ],
        )
        .await
    {
        Ok(rows) => {
            let foreign = rows.iter().any(|row| {
                row.get("owner").and_then(Value::as_str) != Some(caller.user_id.as_str())
            });
            if foreign {
                return error_response(403, "Not your feed.");
            }
        }
        Err(err) => return db_failure(&err, "plan-feed-publish"),
    }

    let Ok(doc) = serde_json::to_vec(&FeedDoc {
        items: request.items,
    }) else {
        return error_response(500, "Could not encode the feed.");
    };
    let row = json!({
        "item_id": request.feed_id,
        "owner": caller.user_id,
        "kind": "feed",
        "feed_token_hash": token_hash_hex(&request.token),
        "state": encode_bytea(&doc),
    });
    match db
        .upsert(SHARED_DOCS, &row, &[("on_conflict", "item_id".to_owned())])
        .await
    {
        Ok(_) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, "plan-feed-publish"),
    }
}

/// Whether `token` has the published shape: `wff_`, then 32 to 64 URL-safe characters.
fn is_feed_token(token: &str) -> bool {
    token.strip_prefix(FEED_PREFIX).is_some_and(|secret| {
        (FEED_SECRET_MIN..=FEED_SECRET_MAX).contains(&secret.len())
            && secret.bytes().all(is_url_safe)
    })
}

/// Whether `id` is 1 to 64 URL-safe characters.
fn is_feed_id(id: &str) -> bool {
    (1..=FEED_ID_MAX).contains(&id.len()) && id.bytes().all(is_url_safe)
}

/// `[A-Za-z0-9_-]`.
fn is_url_safe(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

/// The service-role client; the feed row is read and written as the server.
fn service_db(state: &AppState) -> UserDb<'_> {
    UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    )
}

/// The feed a published `wff_` token names; 404 when no row has its hash.
async fn published_items(state: &AppState, token: &str) -> Result<Vec<FeedMilestone>, Response> {
    let hash = token_hash_hex(token);
    let db = service_db(state);
    let rows = db
        .select(
            SHARED_DOCS,
            &[
                ("select", "state".to_owned()),
                ("kind", eq("feed")),
                ("feed_token_hash", eq(&hash)),
                ("limit", "1".to_owned()),
            ],
        )
        .await
        .map_err(|err| db_failure(&err, "plan-feed"))?;
    let Some(stored) = rows.first().and_then(|row| text(row, "state")) else {
        return Err(error_response(404, "Not found."));
    };
    serde_json::from_slice::<FeedDoc>(&decode_bytea(stored))
        .map(|doc| doc.items)
        .map_err(|_| error_response(500, "Stored feed is unreadable."))
}

/// The milestones of a legacy token's owner, read live from the milestones tables.
async fn legacy_items(state: &AppState, token: &str) -> Result<Vec<FeedMilestone>, Response> {
    // A revoked or unknown link is gone, not unauthorised: calendar apps stop
    // polling a 404 and keep retrying a 401.
    let caller = match require_plan_feed(&state.client, &state.config, token).await {
        Ok(caller) => caller,
        Err(err) if err.status == 401 => return Err(error_response(404, "Not found.")),
        Err(err) => return Err(error_response(err.status, &err.message)),
    };
    load_items(state, &caller).await
}

/// Renders the feed as a calendar (`is_ics`) or a widget document.
fn render(items: &[FeedMilestone], is_ics: bool, params: &HashMap<String, String>) -> Response {
    let include_done = params.get("done").is_some_and(|value| value == "1");
    let reminder_days = params
        .get("alarm")
        .map_or(0, |raw| clamp_alarm(parse_js_int(raw)));
    let now = now_millis();
    let (content_type, body, extra) = if is_ics {
        (
            ICS_TYPE,
            milestones_to_ics(items, include_done, reminder_days, now),
            (
                CONTENT_DISPOSITION,
                "inline; filename=\"weaveforge-deadlines.ics\"",
            ),
        )
    } else {
        (
            JSON_TYPE,
            plan_widget_data(items, include_done, None, now).to_string(),
            (ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
        )
    };

    // Private: the body is one person's plan. Short: a moved deadline should
    // reach the calendar on its next poll. The link is the credential, so keep
    // it out of referrers and indexes.
    let mut response = (
        StatusCode::OK,
        [
            ("content-type", content_type),
            ("cache-control", "private, max-age=300"),
            ("referrer-policy", "no-referrer"),
            ("x-robots-tag", "noindex"),
        ],
        body,
    )
        .into_response();
    let (name, value) = extra;
    let _ = response
        .headers_mut()
        .insert(name, HeaderValue::from_static(value));
    response
}

/// The caller's live milestones, each with its project's name; milestones in a
/// deleted project are dropped.
async fn load_items(state: &AppState, caller: &Caller) -> Result<Vec<FeedMilestone>, Response> {
    let db = user_db(state, caller);
    let milestones_query = [
        ("select", MILESTONE_COLUMNS.to_owned()),
        ("user_id", eq(&caller.user_id)),
        ("deleted_at", "is.null".to_owned()),
    ];
    let projects_query = [
        ("select", "id,name".to_owned()),
        ("user_id", eq(&caller.user_id)),
        ("deleted_at", "is.null".to_owned()),
    ];
    let (milestones, projects) = tokio::join!(
        db.select("milestones", &milestones_query),
        db.select("projects", &projects_query),
    );
    let milestones = match milestones {
        Ok(rows) => rows,
        Err(err) => return Err(db_failure(&err, "plan-feed")),
    };
    let projects = match projects {
        Ok(rows) => rows,
        Err(err) => return Err(db_failure(&err, "plan-feed")),
    };

    let names: HashMap<&str, Option<&str>> = projects
        .iter()
        .filter_map(|row| Some((text(row, "id")?, text(row, "name"))))
        .collect();
    Ok(milestones
        .iter()
        .filter_map(|row| {
            // A milestone in a deleted project went with it.
            let project_name = match text(row, "project_id") {
                None => None,
                Some(project_id) => *names.get(project_id)?,
            };
            Some(FeedMilestone {
                id: text(row, "id").unwrap_or_default().to_owned(),
                title: text(row, "title").unwrap_or_default().to_owned(),
                description: text(row, "description").map(str::to_owned),
                status: text(row, "status").unwrap_or_default().to_owned(),
                target_date: text(row, "target_date").map(str::to_owned),
                project_name: project_name.map(str::to_owned),
            })
        })
        .collect())
}

/// A string field of a row, or `None` when missing or not a string.
fn text<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row.get(key)?.as_str()
}

/// JavaScript `parseInt(text, 10)`: optional sign and leading digits; `None` when there are none.
fn parse_js_int(text: &str) -> Option<i64> {
    let trimmed = text.trim_start();
    let (negative, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    let end = digits
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(digits.len());
    if end == 0 {
        return None;
    }
    let magnitude = digits.get(..end)?.bytes().fold(0_i64, |acc, byte| {
        acc.saturating_mul(10)
            .saturating_add(i64::from(byte.saturating_sub(b'0')))
    });
    Some(if negative { -magnitude } else { magnitude })
}

/// The `alarm` option: 0 when unparsable, otherwise clamped to `0..=30` days.
fn clamp_alarm(days: Option<i64>) -> i64 {
    days.unwrap_or(0).clamp(0, MAX_ALARM_DAYS)
}

/// Milliseconds since the Unix epoch, or 0 before it.
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(0))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::{clamp_alarm, is_feed_id, is_feed_token, parse_js_int};

    #[test]
    fn parses_like_js_parse_int() {
        assert_eq!(parse_js_int("3"), Some(3));
        assert_eq!(parse_js_int("  +7days"), Some(7));
        assert_eq!(parse_js_int("-2"), Some(-2));
        assert_eq!(parse_js_int("abc"), None);
        assert_eq!(parse_js_int(""), None);
        assert_eq!(parse_js_int("-"), None);
    }

    #[test]
    fn alarm_is_clamped_to_zero_thirty() {
        assert_eq!(clamp_alarm(None), 0);
        assert_eq!(clamp_alarm(Some(-5)), 0);
        assert_eq!(clamp_alarm(Some(12)), 12);
        assert_eq!(clamp_alarm(Some(999)), 30);
        assert_eq!(clamp_alarm(parse_js_int("99999999999999999999999")), 30);
    }

    #[test]
    fn feed_token_shape() {
        let secret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
        assert!(is_feed_token(&format!("wff_{secret}")));
        assert!(!is_feed_token(&format!("wff_{}", &secret[..31])));
        assert!(!is_feed_token(&format!("tt_{secret}")));
        assert!(!is_feed_token(&format!("wff_{secret}!")));
    }

    #[test]
    fn feed_id_shape() {
        assert!(is_feed_id("feed-1"));
        assert!(!is_feed_id(""));
        assert!(!is_feed_id("bad id!"));
        assert!(!is_feed_id(&"a".repeat(65)));
    }
}
