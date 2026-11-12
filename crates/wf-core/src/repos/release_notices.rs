//! The `release_notices` repository: the newest release notice, shown once per account.
//!
//! A notice is a row a maintainer inserts after each release (`db/migrations/0156_release_notices.sql`).
//! The dismissal is `user_settings.last_release_notice_seen` (see [`super::user_settings`]).

use serde::{Deserialize, Serialize};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

const TABLE: &str = "release_notices";
const NOTICE_COLUMNS: &str = "version,title,body,published_at";
const SETTINGS_TABLE: &str = "user_settings";

/// A notice row as read (snake_case columns).
#[derive(Debug, Deserialize)]
struct NoticeRow {
    version: String,
    title: String,
    body: String,
    published_at: String,
}

/// The `user_settings` column read for the dismissal.
#[derive(Debug, Deserialize)]
struct SeenRow {
    last_release_notice_seen: Option<String>,
}

/// The notice the banner shows (camelCase).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    version: String,
    title: String,
    body: String,
    published_at: String,
}

impl From<NoticeRow> for Notice {
    fn from(row: NoticeRow) -> Self {
        Self {
            version: row.version,
            title: row.title,
            body: row.body,
            published_at: row.published_at,
        }
    }
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    if method == "unseen" {
        Some(unseen(call))
    } else {
        None
    }
}

/// Whether the latest notice should show: it exists and is not the one already seen.
#[must_use]
pub fn should_show(latest: Option<&str>, seen: Option<&str>) -> bool {
    latest.is_some_and(|v| Some(v) != seen)
}

/// `unseen()`: the newest notice when the caller has not dismissed it, else `null`.
fn unseen(call: &RepoCall) -> RepoStep {
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    if call.replies.is_empty() {
        return RepoStep::Send {
            queries: vec![
                RepoQuery::select(TABLE, NOTICE_COLUMNS)
                    .order("published_at", false)
                    .limit(1),
                RepoQuery::select(SETTINGS_TABLE, "last_release_notice_seen").eq("user_id", user),
            ],
        };
    }
    let notice = match latest_notice(call) {
        Ok(notice) => notice,
        Err(step) => return step,
    };
    let seen = match last_seen(call) {
        Ok(seen) => seen,
        Err(step) => return step,
    };
    match notice {
        Some(notice) if should_show(Some(notice.version.as_str()), seen.as_deref()) => {
            RepoStep::done(&notice)
        }
        _ => RepoStep::unit(),
    }
}

/// Reply 0 as the newest notice row, or `None` when there is none.
fn latest_notice(call: &RepoCall) -> Result<Option<Notice>, RepoStep> {
    match call.reply::<Vec<NoticeRow>>(0) {
        None => Err(RepoStep::fail("reply 0 missing")),
        Some(Err(e)) => Err(RepoStep::fail(e)),
        Some(Ok(rows)) => Ok(rows.into_iter().next().map(Notice::from)),
    }
}

/// Reply 1 as the stored dismissal, or `None` when unset or no settings row.
fn last_seen(call: &RepoCall) -> Result<Option<String>, RepoStep> {
    match call.reply::<Vec<SeenRow>>(1) {
        None => Err(RepoStep::fail("reply 1 missing")),
        Some(Err(e)) => Err(RepoStep::fail(e)),
        Some(Ok(rows)) => Ok(rows
            .into_iter()
            .next()
            .and_then(|row| row.last_release_notice_seen)),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, reason = "test code")]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::{Value, json};

    fn call(replies: Vec<Value>, user: Option<&str>) -> RepoCall {
        RepoCall {
            args: vec![],
            replies,
            ctx: RepoCtx {
                user_id: user.map(Into::into),
                ..RepoCtx::default()
            },
        }
    }

    fn notice_row() -> Value {
        json!([{ "version": "1.2.0", "title": "WeaveForge 1.2.0", "body": "Notes",
            "published_at": "2026-11-01T00:00:00Z" }])
    }

    fn seen(value: &str) -> Value {
        json!([{ "last_release_notice_seen": value }])
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    #[test]
    fn should_show_only_an_unseen_latest_notice() {
        assert!(!should_show(None, None));
        assert!(!should_show(None, Some("1.1.0")));
        assert!(should_show(Some("1.2.0"), None));
        assert!(!should_show(Some("1.2.0"), Some("1.2.0")));
        assert!(should_show(Some("1.2.0"), Some("1.1.0")));
    }

    #[test]
    fn unseen_sends_the_notice_and_the_callers_settings_together() {
        let RepoStep::Send { queries } = unseen(&call(vec![], Some("u1"))) else {
            panic!("expected send");
        };
        assert_eq!(queries.len(), 2);
        let notices = &queries[0];
        assert_eq!(notices.table, "release_notices");
        assert_eq!(notices.action, RepoAction::Select);
        assert_eq!(notices.columns.as_deref(), Some(NOTICE_COLUMNS));
        assert_eq!(notices.order[0].column, "published_at");
        assert!(!notices.order[0].ascending);
        assert_eq!(notices.limit, Some(1));
        let settings = &queries[1];
        assert_eq!(settings.table, "user_settings");
        assert_eq!(settings.columns.as_deref(), Some("last_release_notice_seen"));
        assert_eq!(settings.filters[0].column, "user_id");
        assert_eq!(settings.filters[0].value, "u1");
    }

    #[test]
    fn unseen_returns_the_notice_when_not_dismissed() {
        let v = done(unseen(&call(vec![notice_row(), seen("1.1.0")], Some("u1"))));
        assert_eq!(v["version"], "1.2.0");
        assert_eq!(v["title"], "WeaveForge 1.2.0");
        assert_eq!(v["publishedAt"], "2026-11-01T00:00:00Z");
        let v = done(unseen(&call(vec![notice_row(), json!([])], Some("u1"))));
        assert_eq!(v["version"], "1.2.0");
    }

    #[test]
    fn unseen_is_null_when_dismissed_or_when_there_is_no_notice() {
        assert_eq!(
            done(unseen(&call(vec![notice_row(), seen("1.2.0")], Some("u1")))),
            Value::Null
        );
        assert_eq!(
            done(unseen(&call(vec![json!([]), seen("1.2.0")], Some("u1")))),
            Value::Null
        );
    }

    #[test]
    fn unseen_fails_on_a_bad_reply_or_without_a_user() {
        assert!(matches!(
            unseen(&call(vec![json!({ "version": 1 }), json!([])], Some("u1"))),
            RepoStep::Fail { .. }
        ));
        assert!(matches!(
            unseen(&call(vec![], None)),
            RepoStep::Fail { .. }
        ));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], Some("u1"))).is_none());
        assert!(step("unseen", &call(vec![], Some("u1"))).is_some());
    }
}
