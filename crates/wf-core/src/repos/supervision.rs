//! The supervision repository as Rust-planned queries: a supervisee's milestones and log
//! entries by owner, across all their projects.
//!
//! Ported from `PostgrestSupervisionRepository` in
//! `apps/web/src/features/org/infrastructure/parts.ts`. Not project-scoped: row-level
//! security limits rows to the caller's subtree, and the `user_id` filter narrows to the
//! asked members. The `...For` reads return `[memberId, items]` pairs in the asked order,
//! one per distinct id, empty or not, which TS turns into a `Map`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::logbook::log_entry_row;
use crate::plan::milestone_row::to_milestone;
use crate::postgrest_spec::MILESTONE_COLUMNS;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

/// The columns a [`log_entry_row::LogEntryRow`] is read as, named rather than starred.
pub const LOG_ENTRY_COLUMNS: &str = "id,entry_date,kind,body,links,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "listMilestones" => list_milestones(call),
        "listLogs" => list_logs(call),
        "listMilestonesFor" => list_milestones_for(call),
        "listLogsFor" => list_logs_for(call),
        _ => return None,
    })
}

/// Milestones by target date, undated last.
fn milestones(columns: &str) -> RepoQuery {
    RepoQuery::select("milestones", columns).order_nulls("target_date", true, false)
}

/// Log entries newest first.
fn logs(columns: &str) -> RepoQuery {
    RepoQuery::select("log_entries", columns)
        .order("entry_date", false)
        .order("created_at", false)
}

/// `listMilestones(memberId)`.
fn list_milestones(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(milestones(MILESTONE_COLUMNS).eq("user_id", call.text(0)));
    }
    map_rows(call, 0, to_milestone)
}

/// `listLogs(memberId)`.
fn list_logs(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(logs(LOG_ENTRY_COLUMNS).eq("user_id", call.text(0)));
    }
    map_rows(call, 0, log_entry_row::to_domain)
}

/// `listMilestonesFor(memberIds)`.
fn list_milestones_for(call: &RepoCall) -> RepoStep {
    for_members(call, milestones, MILESTONE_COLUMNS, to_milestone)
}

/// `listLogsFor(memberIds)`.
fn list_logs_for(call: &RepoCall) -> RepoStep {
    for_members(call, logs, LOG_ENTRY_COLUMNS, log_entry_row::to_domain)
}

/// A row with its owner.
#[derive(Deserialize)]
struct Owned<R> {
    user_id: String,
    #[serde(flatten)]
    row: R,
}

/// One read for every asked member, grouped back out by owner in the order asked.
fn for_members<R, D>(
    call: &RepoCall,
    query: fn(&str) -> RepoQuery,
    columns: &str,
    map: fn(&R) -> D,
) -> RepoStep
where
    R: DeserializeOwned,
    D: Serialize,
{
    let ids = match call.parse::<Vec<String>>(0) {
        Ok(ids) => distinct(ids),
        Err(e) => return RepoStep::fail(e),
    };
    if ids.is_empty() {
        return RepoStep::done(&Vec::<(String, Vec<D>)>::new());
    }
    if call.replies.is_empty() {
        let q = query(&format!("{columns},user_id")).filter("in", "user_id", ids);
        return RepoStep::send(q);
    }
    let rows = match call.reply::<Vec<Owned<R>>>(0) {
        Some(Ok(rows)) => rows,
        Some(Err(e)) => return RepoStep::fail(e),
        None => return RepoStep::fail("reply 0 missing"),
    };
    let mut groups: Vec<(String, Vec<D>)> = ids.into_iter().map(|id| (id, Vec::new())).collect();
    for owned in &rows {
        if let Some((_, items)) = groups.iter_mut().find(|(id, _)| *id == owned.user_id) {
            items.push(map(&owned.row));
        }
    }
    RepoStep::done(&groups)
}

/// `ids` with repeats dropped, first occurrence kept.
fn distinct(ids: Vec<String>) -> Vec<String> {
    let mut seen = Vec::with_capacity(ids.len());
    for id in ids {
        if !seen.contains(&id) {
            seen.push(id);
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::RepoCtx;
    use serde_json::{Value, json};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx::default(),
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

    fn milestone(id: &str, owner: &str) -> Value {
        json!({
            "id": id, "title": "T", "description": null, "status": "planned",
            "target_date": null, "dependencies": null, "compute": null,
            "created_at": "2026-11-01", "user_id": owner
        })
    }

    fn log(id: &str, owner: &str) -> Value {
        json!({
            "id": id, "entry_date": "2026-11-01", "kind": "daily", "body": "b",
            "links": null, "created_at": "2026-11-01", "user_id": owner
        })
    }

    #[test]
    fn milestones_order_by_target_date_undated_last() {
        let q = sent(list_milestones(&call(vec![json!("u2")], vec![])));
        assert_eq!(q.filters[0].value, json!("u2"));
        assert_eq!(q.order[0].column, "target_date");
        assert_eq!(q.order[0].nulls_first, Some(false));
        let v = done(list_milestones(&call(
            vec![json!("u2")],
            vec![json!([milestone("m1", "u2")])],
        )));
        assert_eq!(v[0]["id"], "m1");
        assert!(v[0].get("description").is_none());
    }

    #[test]
    fn logs_order_newest_first() {
        let q = sent(list_logs(&call(vec![json!("u2")], vec![])));
        assert_eq!(q.order.len(), 2);
        assert!(!q.order[1].ascending);
        let v = done(list_logs(&call(
            vec![json!("u2")],
            vec![json!([log("l1", "u2")])],
        )));
        assert_eq!(v[0]["id"], "l1");
    }

    #[test]
    fn for_members_with_no_ids_reads_nothing() {
        assert_eq!(
            done(list_logs_for(&call(vec![json!([])], vec![]))),
            json!([])
        );
    }

    #[test]
    fn for_members_groups_by_owner_in_asked_order() {
        let args = vec![json!(["u2", "u1", "u2", "u3"])];
        let q = sent(list_milestones_for(&call(args.clone(), vec![])));
        assert_eq!(q.filters[0].op, "in");
        assert_eq!(q.filters[0].value, json!(["u2", "u1", "u3"]));
        assert!(q.columns.as_deref().unwrap().ends_with(",user_id"));
        let rows = json!([
            milestone("a", "u1"),
            milestone("b", "u2"),
            milestone("c", "u1")
        ]);
        let v = done(list_milestones_for(&call(args, vec![rows])));
        let ids = |i: usize| -> Vec<&str> {
            v[i][1]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["id"].as_str().unwrap())
                .collect()
        };
        assert_eq!(v.as_array().unwrap().len(), 3);
        assert_eq!(v[0][0], "u2");
        assert_eq!(ids(0), ["b"]);
        assert_eq!(ids(1), ["a", "c"]);
        assert_eq!(v[2][0], "u3");
        assert!(ids(2).is_empty());
    }

    #[test]
    fn logs_for_members_strip_the_owner_column() {
        let v = done(list_logs_for(&call(
            vec![json!(["u1"])],
            vec![json!([log("l1", "u1")])],
        )));
        assert_eq!(v[0][1][0]["id"], "l1");
        assert!(v[0][1][0].get("user_id").is_none());
    }
}
