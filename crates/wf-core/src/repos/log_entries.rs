//! The `log_entries` repository as Rust-planned queries.
//!
//! Ported from `PostgrestLogEntryRepository` in
//! `apps/web/src/features/logbook/infrastructure/parts.ts`. Rows map with
//! [`to_domain`] and [`to_row`]. Bodies are end-to-end encrypted, so `bodyContains`
//! has no server filter: the decrypting repository filters after the read.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::logbook::log_entry::{LogEntry, LogKind};
use crate::logbook::log_entry_row::{LogEntryRow, to_domain, to_row};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "log_entries";

/// The columns a [`LogEntryRow`] is read as, named rather than starred.
pub const LOG_ENTRY_COLUMNS: &str = "id,entry_date,kind,body,links,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "save" => save(call),
        "delete" => delete(call),
        _ => return None,
    })
}

/// `LogEntryFilter`, minus `bodyContains` (filtered after decryption).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default)]
    kind: Option<LogKind>,
    #[serde(default)]
    date_from: Option<String>,
    #[serde(default)]
    date_to: Option<String>,
}

/// `getById(id)`: the entry, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, LOG_ENTRY_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<LogEntryRow>| {
        row.as_ref().map(to_domain)
    })
}

/// `list(filter?)`: newest date first, then newest created.
fn list(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    let filter: Filter = if call.arg(0).is_null() {
        Filter::default()
    } else {
        match call.parse(0) {
            Ok(f) => f,
            Err(e) => return RepoStep::fail(e),
        }
    };
    let mut q = RepoQuery::select(TABLE, LOG_ENTRY_COLUMNS);
    if let Some(pid) = call.ctx.project_id.as_deref() {
        q = q.eq("project_id", pid);
    }
    if let Some(kind) = filter.kind {
        q = q.eq("kind", json!(kind));
    }
    if let Some(from) = filter.date_from.filter(|d| !d.is_empty()) {
        q = q.filter("gte", "entry_date", from);
    }
    if let Some(to) = filter.date_to.filter(|d| !d.is_empty()) {
        q = q.filter("lte", "entry_date", to);
    }
    RepoStep::send(q.order("entry_date", false).order("created_at", false))
}

/// `save(entry)`: upsert, stamped with the open project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let entry: LogEntry = match call.parse(0) {
        Ok(entry) => entry,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = json!(to_row(&entry));
    if let (Some(pid), Value::Object(map)) = (call.ctx.project_id.as_deref(), &mut row) {
        let _ = map.insert("project_id".into(), json!(pid));
    }
    RepoStep::send(RepoQuery::upsert(TABLE, row))
}

/// `delete(id)`.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
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
        json!({ "id": "e1", "entry_date": "2026-11-01", "kind": "daily", "body": "b",
            "links": null, "created_at": "2026-11-01T10:00:00Z" })
    }

    #[test]
    fn list_filters_by_project_kind_and_dates_newest_first() {
        let filter = json!({ "kind": "daily", "dateFrom": "2026-01-01", "dateTo": "2026-12-31",
            "bodyContains": "x" });
        let q = sent(list(&call(vec![filter], vec![])));
        let ops: Vec<_> = q
            .filters
            .iter()
            .map(|f| (f.op.as_str(), f.column.as_str()))
            .collect();
        assert_eq!(
            ops,
            [
                ("eq", "project_id"),
                ("eq", "kind"),
                ("gte", "entry_date"),
                ("lte", "entry_date")
            ]
        );
        assert_eq!(q.filters[1].value, json!("daily"));
        assert_eq!(q.order[0].column, "entry_date");
        assert!(!q.order[0].ascending);
        assert_eq!(q.order[1].column, "created_at");
        let v = done(list(&call(vec![], vec![json!([row()])])));
        assert_eq!(v[0]["entryDate"], "2026-11-01");
        assert_eq!(v[0]["links"], json!([]));
    }

    #[test]
    fn list_without_project_or_filter_reads_everything() {
        let mut c = call(vec![], vec![]);
        c.ctx.project_id = None;
        assert!(sent(list(&c)).filters.is_empty());
    }

    #[test]
    fn get_by_id_maps_a_missing_row_to_null() {
        let q = sent(get_by_id(&call(vec![json!("e1")], vec![])));
        assert_eq!(q.filters[0].value, json!("e1"));
        let none = get_by_id(&call(vec![json!("e1")], vec![Value::Null]));
        assert_eq!(done(none), Value::Null);
        assert_eq!(
            done(get_by_id(&call(vec![json!("e1")], vec![row()])))["id"],
            "e1"
        );
    }

    #[test]
    fn save_upserts_the_row_with_the_project() {
        let entry = json!({ "id": "e1", "entryDate": "2026-11-01", "kind": "daily", "body": "b",
            "links": [], "createdAt": "2026-11-01T10:00:00Z" });
        let q = sent(save(&call(vec![entry], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["entry_date"], "2026-11-01");
        assert!(matches!(
            save(&call(vec![json!({})], vec![])),
            RepoStep::Fail { .. }
        ));
    }

    #[test]
    fn delete_targets_the_id() {
        let q = sent(step("delete", &call(vec![json!("e1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].value, json!("e1"));
    }
}
