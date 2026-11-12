//! The `ai_proposals` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/ai-assistant/infrastructure/postgrest-ai-proposal-store.ts`
//! (`PostgrestAiProposalStore`). `content` holds the whole proposal as jsonb; the indexed
//! lifecycle columns are laid over it when a row is read back.

use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

const TABLE: &str = "ai_proposals";

/// The columns a proposal is read as, named rather than starred.
const PROPOSAL_COLUMNS: &str =
    "id,kind,status,resource_type,resource_id,expected_revision,content,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "save" => save(call),
        "claimPending" => claim_pending(call),
        "getById" => get_by_id(call),
        "listPending" => list_pending(call),
        _ => return None,
    })
}

/// The proposal fields `save` reads from its argument; the whole argument is stored as `content`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    id: String,
    kind: Value,
    status: Value,
    resource_id: String,
    expected_revision: Option<String>,
    created_at: String,
}

/// A stored row, as `PROPOSAL_COLUMNS` reads it.
#[derive(Deserialize)]
struct ProposalRow {
    id: String,
    kind: Value,
    status: Value,
    resource_id: String,
    expected_revision: Option<String>,
    content: Value,
    created_at: String,
}

/// `save(proposal)`: upserts by id for the signed-in user, in the selected project when set.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let proposal: SaveInput = match call.parse(0) {
        Ok(proposal) => proposal,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(RepoQuery::upsert(
        TABLE,
        json!({
            "id": proposal.id,
            "user_id": user,
            "project_id": call.ctx.project_id.as_deref(),
            "kind": proposal.kind,
            "status": proposal.status,
            "resource_type": proposal.kind,
            "resource_id": proposal.resource_id,
            "expected_revision": proposal.expected_revision,
            "content": call.arg(0),
            "created_at": proposal.created_at,
            "updated_at": call.now(),
        }),
    ))
}

/// `claimPending(id)`: true when this call moved the row from `pending` to `executing`.
///
/// One conditional update: of two callers, only one sees its row come back.
fn claim_pending(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::update(
                TABLE,
                json!({ "status": "executing", "updated_at": call.now() }),
            )
            .eq("id", call.text(0))
            .eq("status", "pending")
            .returning("id"),
        );
    }
    match call.reply::<Option<Vec<Value>>>(0) {
        Some(Ok(rows)) => RepoStep::done(&(rows.unwrap_or_default().len() == 1)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `getById(id)`: the proposal, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, PROPOSAL_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    match call.reply::<Option<ProposalRow>>(0) {
        Some(Ok(Some(row))) => RepoStep::done(&from_row(&row)),
        Some(Ok(None)) => RepoStep::unit(),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `listPending()`: pending proposals, newest first.
fn list_pending(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, PROPOSAL_COLUMNS)
                .eq("status", "pending")
                .order("created_at", false),
        );
    }
    map_rows(call, 0, from_row)
}

/// The stored proposal with the indexed lifecycle columns laid over `content`.
fn from_row(row: &ProposalRow) -> Value {
    let mut proposal = match &row.content {
        Value::Object(fields) => fields.clone(),
        _ => Map::new(),
    };
    let _ = proposal.insert("id".into(), json!(row.id));
    let _ = proposal.insert("kind".into(), row.kind.clone());
    let _ = proposal.insert("status".into(), row.status.clone());
    let _ = proposal.insert("resourceId".into(), json!(row.resource_id));
    let _ = match &row.expected_revision {
        Some(revision) => proposal.insert("expectedRevision".into(), json!(revision)),
        None => proposal.remove("expectedRevision"),
    };
    let _ = proposal.insert("createdAt".into(), json!(row.created_at));
    Value::Object(proposal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: Some("u1".into()),
                now: Some("2026-02-02T00:00:00.000Z".into()),
                id_seed: None,
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

    fn proposal() -> Value {
        json!({
            "id": "p1", "kind": "paperUpdate", "status": "pending", "resourceId": "r1",
            "expectedRevision": "3", "createdAt": "2026-01-01T00:00:00.000Z", "payload": {"a": 1}
        })
    }

    fn row() -> Value {
        json!({
            "id": "p1", "kind": "paperUpdate", "status": "pending", "resource_type": "paperUpdate",
            "resource_id": "r1", "expected_revision": "3",
            "content": {"id": "stale", "payload": {"a": 1}},
            "created_at": "2026-01-01T00:00:00.000Z"
        })
    }

    #[test]
    fn save_upserts_owned_row_with_content() {
        let q = only(step("save", &call(vec![proposal()], vec![])).unwrap());
        assert_eq!(q.table, "ai_proposals");
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict, None);
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["resource_type"], "paperUpdate");
        assert_eq!(body["resource_id"], "r1");
        assert_eq!(body["expected_revision"], "3");
        assert_eq!(body["created_at"], "2026-01-01T00:00:00.000Z");
        assert_eq!(body["updated_at"], "2026-02-02T00:00:00.000Z");
        assert_eq!(body["content"], proposal());
    }

    #[test]
    fn save_stores_null_when_no_revision_or_project() {
        let mut no_rev = proposal();
        let _ = no_rev.as_object_mut().unwrap().remove("expectedRevision");
        let mut c = call(vec![no_rev], vec![]);
        c.ctx.project_id = None;
        let body = only(step("save", &c).unwrap()).body.unwrap();
        assert_eq!(body["expected_revision"], Value::Null);
        assert_eq!(body["project_id"], Value::Null);
    }

    #[test]
    fn save_fails_without_user() {
        let mut c = call(vec![proposal()], vec![]);
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
    fn claim_pending_is_conditional_update_returning_id() {
        let q = only(step("claimPending", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Update);
        assert_eq!(
            q.body,
            Some(json!({"status": "executing", "updated_at": "2026-02-02T00:00:00.000Z"}))
        );
        assert_eq!(q.filters[0].value, "p1");
        assert_eq!(q.filters[1].column, "status");
        assert_eq!(q.filters[1].value, "pending");
        assert_eq!(q.columns.as_deref(), Some("id"));
    }

    #[test]
    fn claim_pending_true_only_for_one_returned_row() {
        let won = step("claimPending", &call(vec![], vec![json!([{"id": "p1"}])])).unwrap();
        assert_eq!(won, RepoStep::Done { value: json!(true) });
        let lost = step("claimPending", &call(vec![], vec![json!([])])).unwrap();
        assert_eq!(
            lost,
            RepoStep::Done {
                value: json!(false)
            }
        );
        let none = step("claimPending", &call(vec![], vec![Value::Null])).unwrap();
        assert_eq!(
            none,
            RepoStep::Done {
                value: json!(false)
            }
        );
    }

    #[test]
    fn claim_pending_fails_on_bad_reply() {
        let s = step("claimPending", &call(vec![], vec![json!("x")])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn get_by_id_selects_one_or_null() {
        let q = only(step("getById", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(q.columns.as_deref(), Some(PROPOSAL_COLUMNS));
        assert_eq!(q.filters[0].value, "p1");
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(
            step("getById", &call(vec![], vec![Value::Null])),
            Some(RepoStep::unit())
        );
    }

    #[test]
    fn get_by_id_maps_row_over_content() {
        let s = step("getById", &call(vec![], vec![row()])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["id"], "p1");
        assert_eq!(value["resourceId"], "r1");
        assert_eq!(value["expectedRevision"], "3");
        assert_eq!(value["createdAt"], "2026-01-01T00:00:00.000Z");
        assert_eq!(value["payload"]["a"], 1);
    }

    #[test]
    fn get_by_id_drops_null_revision() {
        let mut r = row();
        r["expected_revision"] = Value::Null;
        let s = step("getById", &call(vec![], vec![r])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert!(value.get("expectedRevision").is_none());
    }

    #[test]
    fn list_pending_newest_first() {
        let q = only(step("listPending", &call(vec![], vec![])).unwrap());
        assert_eq!(q.filters[0].column, "status");
        assert_eq!(q.filters[0].value, "pending");
        assert!(!q.order[0].ascending);
        assert_eq!(q.order[0].column, "created_at");
    }

    #[test]
    fn list_pending_maps_rows() {
        let s = step("listPending", &call(vec![], vec![json!([row()])])).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["resourceId"], "r1");
    }

    #[test]
    fn list_pending_fails_on_bad_row() {
        let s = step("listPending", &call(vec![], vec![json!([{"id": 1}])])).unwrap();
        assert!(matches!(s, RepoStep::Fail { .. }));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
