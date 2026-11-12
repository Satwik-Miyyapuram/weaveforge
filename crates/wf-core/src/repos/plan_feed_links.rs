//! The `api_tokens` plan-feed link as Rust-planned queries.
//!
//! Ported from `PlanFeedLinks` in `apps/web/src/features/plan/infrastructure/plan-feed-links.ts`.
//! Token generation and SHA-256 hashing stay in TS (crypto): `create` takes the already-hashed
//! token (`token_hash`, bytea-encoded) and its `token_prefix`, and returns the stored link.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row};

const TABLE: &str = "api_tokens";

/// The columns a [`LinkRow`] is read as, named rather than starred.
const LINK_COLUMNS: &str = "id,token_prefix,created_at,last_used_at";

/// The scope that marks a plan-feed link (`PLAN_FEED_SCOPE` in TS).
const PLAN_FEED_SCOPE: &str = "plan_feed";

/// The `name` written on a new link.
const LINK_NAME: &str = "Calendar and widget link";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "current" => current(call),
        "create" => create(call),
        "revoke" => revoke(call),
        _ => return None,
    })
}

/// A row of `api_tokens` as read by [`LINK_COLUMNS`].
#[derive(Deserialize)]
struct LinkRow {
    id: String,
    token_prefix: String,
    created_at: String,
    last_used_at: Option<String>,
}

/// `PlanFeedLink`: the link a calendar subscribes to. Never carries the token.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFeedLink {
    /// The row id.
    id: String,
    /// First characters of the token.
    token_prefix: String,
    /// When the link was made.
    created_at: String,
    /// When a calendar last fetched it.
    last_used_at: Option<String>,
}

fn to_domain(row: &LinkRow) -> PlanFeedLink {
    PlanFeedLink {
        id: row.id.clone(),
        token_prefix: row.token_prefix.clone(),
        created_at: row.created_at.clone(),
        last_used_at: row.last_used_at.clone(),
    }
}

/// Narrows `query` to rows whose `scopes` contain the plan-feed scope (`contains("scopes", [X])`).
fn with_feed_scope(query: RepoQuery) -> RepoQuery {
    query.filter(
        "filter",
        "scopes",
        json!(["cs", format!("{{{PLAN_FEED_SCOPE}}}")]),
    )
}

/// `current()`: the newest plan-feed link, or `null`.
fn current(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            with_feed_scope(RepoQuery::select(TABLE, LINK_COLUMNS))
                .order("created_at", false)
                .limit(1),
        );
    }
    map_row(call, 0, |rows: &Vec<LinkRow>| rows.first().map(to_domain))
}

/// `create(tokenHash, tokenPrefix)`: inserts the new link, then removes every other one. Insert
/// first: if it fails, the old link still works instead of the account being left with none.
fn create(call: &RepoCall) -> RepoStep {
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    match call.replies.len() {
        0 => RepoStep::send(
            RepoQuery::insert(
                TABLE,
                json!({
                    "user_id": user,
                    "name": LINK_NAME,
                    "token_hash": call.text(0),
                    "token_prefix": call.text(1),
                    "scopes": [PLAN_FEED_SCOPE],
                    "expires_at": null,
                }),
            )
            .returning(LINK_COLUMNS)
            .single(),
        ),
        1 => match call.reply::<LinkRow>(0) {
            Some(Ok(row)) => RepoStep::send(
                with_feed_scope(RepoQuery::delete(TABLE)).filter("neq", "id", row.id),
            ),
            Some(Err(e)) => RepoStep::fail(e),
            None => RepoStep::fail("reply 0 missing"),
        },
        _ => map_row(call, 0, to_domain),
    }
}

/// `revoke()`: deletes every plan-feed link.
fn revoke(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(with_feed_scope(RepoQuery::delete(TABLE)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: Some("u1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn sent(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } => queries.remove(0),
            other => panic!("expected send, got {other:?}"),
        }
    }

    fn done(step: RepoStep) -> Value {
        match step {
            RepoStep::Done { value } => value,
            other => panic!("expected done, got {other:?}"),
        }
    }

    fn row() -> Value {
        json!({ "id": "l1", "token_prefix": "tt_abcdefgh\u{2026}",
            "created_at": "2026-11-01T10:00:00Z", "last_used_at": null })
    }

    fn feed_scope() -> Value {
        json!(["cs", "{plan_feed}"])
    }

    #[test]
    fn current_reads_the_newest_feed_link() {
        let q = sent(current(&call(vec![], vec![])));
        assert_eq!(q.action, RepoAction::Select);
        assert_eq!(q.columns.as_deref(), Some(LINK_COLUMNS));
        assert_eq!(q.filters[0].op, "filter");
        assert_eq!(q.filters[0].column, "scopes");
        assert_eq!(q.filters[0].value, feed_scope());
        assert_eq!(q.order[0].column, "created_at");
        assert!(!q.order[0].ascending);
        assert_eq!(q.limit, Some(1));
    }

    #[test]
    fn current_maps_the_first_row_or_null() {
        let v = done(current(&call(vec![], vec![json!([row()])])));
        assert_eq!(v["id"], "l1");
        assert_eq!(v["tokenPrefix"], "tt_abcdefgh\u{2026}");
        assert_eq!(v["createdAt"], "2026-11-01T10:00:00Z");
        assert_eq!(v["lastUsedAt"], Value::Null);
        assert_eq!(done(current(&call(vec![], vec![json!([])]))), Value::Null);
    }

    #[test]
    fn create_inserts_the_hashed_token_then_revokes_the_others() {
        let args = vec![json!("hash"), json!("tt_abcdefgh\u{2026}")];
        let insert = sent(create(&call(args.clone(), vec![])));
        assert_eq!(insert.action, RepoAction::Insert);
        assert_eq!(insert.columns.as_deref(), Some(LINK_COLUMNS));
        assert!(insert.single == crate::repo_query::RepoSingle::One);
        let body = insert.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["token_hash"], "hash");
        assert_eq!(body["token_prefix"], "tt_abcdefgh\u{2026}");
        assert_eq!(body["scopes"], json!(["plan_feed"]));
        assert_eq!(body["expires_at"], Value::Null);
        assert_eq!(body["name"], LINK_NAME);

        let revoke = sent(create(&call(args, vec![row()])));
        assert_eq!(revoke.action, RepoAction::Delete);
        assert_eq!(revoke.filters[0].value, feed_scope());
        assert_eq!(revoke.filters[1].op, "neq");
        assert_eq!(revoke.filters[1].column, "id");
        assert_eq!(revoke.filters[1].value, "l1");
    }

    #[test]
    fn create_returns_the_stored_link() {
        let v = done(create(&call(
            vec![json!("hash"), json!("p")],
            vec![row(), Value::Null],
        )));
        assert_eq!(v["id"], "l1");
        assert_eq!(v["lastUsedAt"], Value::Null);
    }

    #[test]
    fn create_fails_when_not_signed_in() {
        let mut c = call(vec![json!("\\xabc"), json!("p")], vec![]);
        c.ctx.user_id = None;
        match create(&c) {
            RepoStep::Fail { message, .. } => assert_eq!(message, "Not signed in."),
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[test]
    fn revoke_deletes_feed_links_without_a_project() {
        let q = sent(revoke(&call(vec![], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, feed_scope());
        assert!(matches!(
            revoke(&call(vec![], vec![Value::Null])),
            RepoStep::Done { .. }
        ));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("list", &call(vec![], vec![])).is_none());
        assert!(step("current", &call(vec![], vec![])).is_some());
    }
}
