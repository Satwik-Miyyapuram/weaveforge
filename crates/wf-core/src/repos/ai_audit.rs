//! The `ai_audit_records` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/ai-assistant/infrastructure/postgrest-ai-proposal-store.ts`
//! (`PostgrestAiAuditStore`). Each row keeps the whole record as `content` next to the indexed
//! `action` and `proposal_id` columns; `countAccepted` counts the active project's accepted rows.

use serde::Deserialize;
use serde_json::json;

use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

const TABLE: &str = "ai_audit_records";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "save" => save(call),
        "countAccepted" => count_accepted(call),
        _ => return None,
    })
}

/// The audit fields `save` reads from its argument; the whole argument is stored as `content`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    id: String,
    proposal_id: String,
    action: String,
    created_at: String,
}

/// `save(record)`: appends the audit row for the signed-in user, in the selected project when set.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let record: SaveInput = match call.parse(0) {
        Ok(record) => record,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(RepoQuery::insert(
        TABLE,
        json!({
            "id": record.id,
            "user_id": user,
            "project_id": call.ctx.project_id.as_deref(),
            "proposal_id": record.proposal_id,
            "action": record.action,
            "content": call.arg(0),
            "created_at": record.created_at,
        }),
    ))
}

/// `countAccepted()`: how many `accepted` rows the active project has; `0` with no project.
fn count_accepted(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let Some(project) = call.ctx.project_id.as_deref().filter(|id| !id.is_empty()) else {
            return RepoStep::done(&0_u64);
        };
        return RepoStep::send(
            RepoQuery::count(TABLE)
                .eq("project_id", project)
                .eq("action", "accepted"),
        );
    }
    match call.reply::<Option<u64>>(0) {
        Some(Ok(count)) => RepoStep::done(&count.unwrap_or(0)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::Value;

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: Some("u1".into()),
                now: Some("2026-02-02T00:00:00.000Z".into()),
            },
            replies,
        }
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn record() -> Value {
        json!({
            "id": "a1", "proposalId": "p1", "action": "accepted",
            "createdAt": "2026-01-01T00:00:00.000Z"
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn save_inserts_audit_row_with_whole_record_as_content() {
        let q = only(step("save", &call(vec![record()], vec![])).unwrap());
        assert_eq!(q.table, "ai_audit_records");
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.columns, None);
        let body = q.body.unwrap();
        assert_eq!(body["id"], "a1");
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["proposal_id"], "p1");
        assert_eq!(body["action"], "accepted");
        assert_eq!(body["created_at"], "2026-01-01T00:00:00.000Z");
        assert_eq!(body["content"], record());
    }

    #[test]
    fn save_stores_null_project_when_none_selected() {
        let mut c = call(vec![record()], vec![]);
        c.ctx.project_id = None;
        let body = only(step("save", &c).unwrap()).body.unwrap();
        assert_eq!(body["project_id"], Value::Null);
    }

    #[test]
    fn save_fails_without_user() {
        let mut c = call(vec![record()], vec![]);
        c.ctx.user_id = None;
        assert_eq!(step("save", &c), Some(RepoStep::fail("Not signed in.")));
    }

    #[test]
    fn save_fails_on_bad_input() {
        let s = step("save", &call(vec![json!({"id": 1})], vec![])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn save_finishes_after_reply() {
        assert_eq!(
            step("save", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn count_accepted_counts_accepted_rows_of_project() {
        let q = only(step("countAccepted", &call(vec![], vec![])).unwrap());
        assert_eq!(q.table, "ai_audit_records");
        assert_eq!(q.action, RepoAction::Select);
        assert!(q.count);
        assert_eq!(q.columns.as_deref(), Some("id"));
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, "p1");
        assert_eq!(q.filters[1].column, "action");
        assert_eq!(q.filters[1].value, "accepted");
    }

    #[test]
    fn count_accepted_is_zero_without_project_and_sends_nothing() {
        let mut c = call(vec![], vec![]);
        c.ctx.project_id = Some(String::new());
        assert_eq!(
            step("countAccepted", &c),
            Some(RepoStep::Done { value: json!(0) })
        );
    }

    #[test]
    fn count_accepted_maps_reply_number() {
        let s = step("countAccepted", &call(vec![], vec![json!(4)])).unwrap();
        assert_eq!(s, RepoStep::Done { value: json!(4) });
    }

    #[test]
    fn count_accepted_null_reply_is_zero() {
        let s = step("countAccepted", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(s, RepoStep::Done { value: json!(0) });
    }

    #[test]
    fn count_accepted_fails_on_bad_reply() {
        let s = step("countAccepted", &call(vec![], vec![json!("x")])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }
}
