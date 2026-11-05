//! The plan feed route: `deadlines.ics` for a calendar, `widget.json` for widgets.
//! Port of `apps/web/src/app/api/plan/feed/[token]/[file]/route.ts`.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_DISPOSITION};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::Value;

use wf_core::plan::feed::{FeedMilestone, milestones_to_ics, plan_widget_data};

use crate::auth::{Caller, require_plan_feed};
use crate::postgrest::eq;
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, user_db};

const ICS_FILE: &str = "deadlines.ics";
const WIDGET_FILE: &str = "widget.json";
const ICS_TYPE: &str = "text/calendar; charset=utf-8";
const JSON_TYPE: &str = "application/json; charset=utf-8";
const MILESTONE_COLUMNS: &str =
    "id,title,description,status,target_date,dependencies,compute,created_at,project_id";
const MAX_ALARM_DAYS: i64 = 30;

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
    // A revoked or unknown link is gone, not unauthorised: calendar apps stop
    // polling a 404 and keep retrying a 401.
    let caller = match require_plan_feed(&state.client, &state.config, &token).await {
        Ok(caller) => caller,
        Err(err) if err.status == 401 => return error_response(404, "Not found."),
        Err(err) => return error_response(err.status, &err.message),
    };
    let items = match load_items(&state, &caller).await {
        Ok(items) => items,
        Err(response) => return response,
    };
    let include_done = params.get("done").is_some_and(|value| value == "1");
    let reminder_days = params
        .get("alarm")
        .map_or(0, |raw| clamp_alarm(parse_js_int(raw)));
    let now = now_millis();
    let (content_type, body, extra) = if is_ics {
        (
            ICS_TYPE,
            milestones_to_ics(&items, include_done, reminder_days, now),
            (
                CONTENT_DISPOSITION,
                "inline; filename=\"weaveforge-deadlines.ics\"",
            ),
        )
    } else {
        (
            JSON_TYPE,
            plan_widget_data(&items, include_done, None, now).to_string(),
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
    use super::{clamp_alarm, parse_js_int};

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
}
