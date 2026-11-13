//! The `lab_snapshots` repository as Rust-planned queries.
//!
//! Ported from `PostgrestLabSnapshotRepository` in
//! `apps/web/src/features/org/infrastructure/parts.ts`. The title rule is
//! [`validate_snapshot_title`] and rows map with [`to_domain`].

use serde::Deserialize;
use serde_json::{Value, json};

use crate::lab_snapshot::validate_snapshot_title;
use crate::lab_snapshot_rows::{LabSnapshotRow, to_domain};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "lab_snapshots";

/// The columns a [`LabSnapshotRow`] is read as, named rather than starred.
pub const LAB_SNAPSHOT_COLUMNS: &str = "id,project_id,title,note,content,published_at,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "publish" => publish(call),
        "remove" => remove(call),
        "listMine" => list_mine(call),
        "listForMember" => list_for(call, call.text(0)),
        "getById" => get_by_id(call),
        _ => return None,
    })
}

/// `PublishLabSnapshotInput`: the content is stored as sent.
#[derive(Deserialize)]
struct PublishInput {
    title: String,
    #[serde(default)]
    note: Option<String>,
    content: Value,
}

/// `publish(input)`: the stored snapshot, in the open project, owned by the caller.
fn publish(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_row(call, 0, to_domain);
    }
    let input: PublishInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let title = match validate_snapshot_title(&input.title) {
        Ok(title) => title,
        Err(e) => return RepoStep::fail(e),
    };
    let (uid, project) = match (call.user(), call.project("publishing a lab snapshot")) {
        (Ok(uid), Ok(project)) => (uid, project),
        (Err(step), _) | (_, Err(step)) => return step,
    };
    let note = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty());
    RepoStep::send(
        RepoQuery::insert(
            TABLE,
            json!({
                "user_id": uid,
                "project_id": project,
                "title": title,
                "note": note,
                "content": input.content,
            }),
        )
        .returning(LAB_SNAPSHOT_COLUMNS)
        .single(),
    )
}

/// `remove(id)`.
fn remove(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `listMine()`: the caller's snapshots, newest first.
fn list_mine(call: &RepoCall) -> RepoStep {
    match call.user() {
        Ok(uid) => list_for(call, uid),
        Err(step) => step,
    }
}

/// The snapshots `user_id` published, newest first.
fn list_for(call: &RepoCall, user_id: &str) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, LAB_SNAPSHOT_COLUMNS)
                .eq("user_id", user_id)
                .order("published_at", false),
        );
    }
    map_rows(call, 0, to_domain)
}

/// `getById(id)`: the snapshot, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, LAB_SNAPSHOT_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<LabSnapshotRow>| {
        row.as_ref().map(to_domain)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                user_id: Some("u1".into()),
                project_id: Some("p1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn row(id: &str) -> Value {
        json!({
            "id": id, "project_id": "p1", "title": "T", "note": null, "content": null,
            "published_at": "2026-11-01", "created_at": "2026-11-01"
        })
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

    #[test]
    fn publish_trims_note_and_scopes_to_caller_and_project() {
        let input = json!({ "title": "  Week 3 ", "note": "   ", "content": { "milestones": [], "logs": [] } });
        let q = sent(publish(&call(vec![input], vec![])));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["note"], Value::Null);
        assert_eq!(q.single, RepoSingle::One);
        let v = done(publish(&call(vec![], vec![row("s1")])));
        assert_eq!(v["projectId"], "p1");
        assert_eq!(v["content"]["logs"], json!([]));
        assert!(v.get("note").is_none());
    }

    #[test]
    fn publish_rejects_a_blank_title_without_a_query() {
        let input = json!({ "title": "  ", "content": {} });
        assert!(matches!(
            publish(&call(vec![input], vec![])),
            RepoStep::Fail { .. }
        ));
    }

    #[test]
    fn publish_needs_a_project() {
        let mut c = call(vec![json!({ "title": "T", "content": {} })], vec![]);
        c.ctx.project_id = None;
        assert!(matches!(publish(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn lists_filter_by_owner_newest_first() {
        let mine = sent(list_mine(&call(vec![], vec![])));
        assert_eq!(mine.filters[0].value, json!("u1"));
        assert!(!mine.order[0].ascending);
        let theirs = sent(step("listForMember", &call(vec![json!("u2")], vec![])).unwrap());
        assert_eq!(theirs.filters[0].value, json!("u2"));
        let v = done(list_mine(&call(vec![], vec![json!([row("a"), row("b")])])));
        assert_eq!(v.as_array().unwrap().len(), 2);
    }

    #[test]
    fn get_by_id_maps_a_missing_row_to_null() {
        let q = sent(get_by_id(&call(vec![json!("s1")], vec![])));
        assert_eq!(q.single, RepoSingle::Maybe);
        assert_eq!(
            done(get_by_id(&call(vec![json!("s1")], vec![Value::Null]))),
            Value::Null
        );
        assert_eq!(
            done(get_by_id(&call(vec![json!("s1")], vec![row("s1")])))["id"],
            "s1"
        );
    }

    #[test]
    fn remove_deletes_by_id() {
        let q = sent(remove(&call(vec![json!("s1")], vec![])));
        assert_eq!(q.filters[0].value, json!("s1"));
        assert!(matches!(
            remove(&call(vec![json!("s1")], vec![Value::Null])),
            RepoStep::Done { .. }
        ));
    }
}
