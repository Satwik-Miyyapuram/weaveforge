//! The `log_entries` repository as Rust-planned queries.
//!
//! Ported from `PostgrestLogEntryRepository` in
//! `apps/web/src/features/logbook/infrastructure/parts.ts`. Rows map with
//! [`to_domain`] and [`to_row`]. Bodies are end-to-end encrypted, so `bodyContains`
//! has no server filter: the decrypting repository filters after the read.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::logbook::log_entry::{LogEntry, LogKind, NewLogEntryInput, create_log_entry};
use crate::logbook::log_entry_row::{LogEntryRow, to_domain, to_row};
use crate::reader_analysis::lines::js_trim;
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
        "add" => add(call),
        "update" => update(call),
        "remove" => delete(call),
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

/// `EditLogEntryInput`: the editable fields. A missing or blank body is rejected.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    #[serde(default)]
    body: Option<String>,
    kind: LogKind,
}

/// `add(input)`: builds the entry with `call.id(0)` and the sender's clock, then saves it.
/// Validation fails before anything is sent; the result is the entry once the save replies.
fn add(call: &RepoCall) -> RepoStep {
    let input: NewLogEntryInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let entry = match create_log_entry(input, &call.id(0), call.now()) {
        Ok(entry) => entry,
        Err(e) => return RepoStep::fail_named("LogEntryValidationError", e),
    };
    let value = match serde_json::to_value(&entry) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], 0));
    if call.replies.is_empty() || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&entry)
}

/// `update(id, input)`: reads the entry (a missing one fails as NotFound), checks the trimmed
/// body, then saves it with the new body and kind. Id, date and creation time are kept.
fn update(call: &RepoCall) -> RepoStep {
    let input: EditInput = match call.parse(1) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let existing = match get_by_id(&call.sub(vec![json!(call.text(0))], 0)) {
        RepoStep::Done { value } => value,
        other => return other,
    };
    let existing: Option<LogEntry> = match serde_json::from_value(existing) {
        Ok(existing) => existing,
        Err(e) => return RepoStep::fail(e),
    };
    let Some(existing) = existing else {
        return RepoStep::fail_named(
            "NotFoundError",
            format!("No log entry with id \"{}\".", call.text(0)),
        );
    };
    let body = js_trim(input.body.as_deref().unwrap_or_default());
    if body.is_empty() {
        return RepoStep::fail_named("LogEntryValidationError", "Log entry body is required.");
    }
    let updated = LogEntry {
        body: body.to_owned(),
        kind: input.kind,
        ..existing
    };
    let value = match serde_json::to_value(&updated) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], 1));
    if call.replies.len() < 2 || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&updated)
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
        let removed = sent(step("remove", &call(vec![json!("e1")], vec![])).unwrap());
        assert_eq!(removed.action, RepoAction::Delete);
    }

    const NOW: &str = "2026-11-01T10:00:00Z";

    /// A call with the seeded id and clock that `add` and `update` read.
    fn fresh(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        let mut c = call(args, replies);
        c.ctx.id_seed = Some("seed".into());
        c.ctx.now = Some(NOW.into());
        c
    }

    fn failed(step: RepoStep) -> (String, Option<String>) {
        match step {
            RepoStep::Fail { message, name } => (message, name),
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[test]
    fn add_saves_a_trimmed_entry_with_defaults() {
        let c = fresh(vec![json!({ "body": "  hi  " })], vec![]);
        let q = sent(add(&c));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["id"], c.id(0));
        assert_eq!(body["body"], "hi");
        assert_eq!(body["kind"], "daily");
        assert_eq!(body["entry_date"], "2026-11-01");
        assert_eq!(body["project_id"], "p1");
    }

    #[test]
    fn add_honours_the_given_date_and_kind() {
        let input = json!({ "body": "x", "kind": "daily", "entryDate": "2026-01-02" });
        let body = sent(add(&fresh(vec![input], vec![]))).body.unwrap();
        assert_eq!(body["entry_date"], "2026-01-02");
        assert_eq!(body["kind"], "daily");
    }

    #[test]
    fn add_returns_the_saved_entry() {
        let c = fresh(vec![json!({ "body": "hi" })], vec![Value::Null]);
        let v = done(add(&c));
        assert_eq!(v["id"], c.id(0));
        assert_eq!(v["createdAt"], NOW);
    }

    #[test]
    fn add_rejects_a_blank_body_before_saving() {
        let (message, name) = failed(add(&fresh(vec![json!({ "body": "  " })], vec![])));
        assert_eq!(message, "Log entry body is required.");
        assert_eq!(name.as_deref(), Some("LogEntryValidationError"));
    }

    #[test]
    fn update_keeps_id_date_and_creation_time() {
        let args = vec![json!("e1"), json!({ "body": " new ", "kind": "daily" })];
        let q = sent(update(&fresh(args.clone(), vec![row()])));
        assert_eq!(q.action, RepoAction::Upsert);
        let v = done(update(&fresh(args, vec![row(), Value::Null])));
        assert_eq!(v["id"], "e1");
        assert_eq!(v["entryDate"], "2026-11-01");
        assert_eq!(v["createdAt"], "2026-11-01T10:00:00Z");
        assert_eq!(v["body"], "new");
    }

    #[test]
    fn update_of_a_missing_entry_is_not_found() {
        let args = vec![json!("e1"), json!({ "body": "x", "kind": "daily" })];
        let (message, name) = failed(update(&fresh(args, vec![Value::Null])));
        assert_eq!(message, "No log entry with id \"e1\".");
        assert_eq!(name.as_deref(), Some("NotFoundError"));
    }

    #[test]
    fn update_rejects_a_blank_body() {
        let args = vec![json!("e1"), json!({ "body": "   ", "kind": "daily" })];
        let (message, name) = failed(update(&fresh(args, vec![row()])));
        assert_eq!(message, "Log entry body is required.");
        assert_eq!(name.as_deref(), Some("LogEntryValidationError"));
    }

    #[test]
    fn add_honours_explicit_kind_date_and_links() {
        let input = json!({
            "body": "weekly summary",
            "kind": "weekly",
            "entryDate": "2026-07-20",
            "links": [{ "type": "experiment", "id": "exp-1" }]
        });
        let body = sent(add(&fresh(vec![input], vec![]))).body.unwrap();
        assert_eq!(body["kind"], "weekly");
        assert_eq!(body["entry_date"], "2026-07-20");
        assert_eq!(body["links"], json!([{ "type": "experiment", "id": "exp-1" }]));
    }

    #[test]
    fn update_edits_body_kind_while_preserving_id_date_createdat() {
        let args = vec![json!("e1"), json!({ "body": "  edited  ", "kind": "weekly" })];
        let v = done(update(&fresh(args, vec![row(), Value::Null])));
        assert_eq!(v["id"], "e1");
        assert_eq!(v["entryDate"], "2026-11-01");
        assert_eq!(v["createdAt"], "2026-11-01T10:00:00Z");
        assert_eq!(v["body"], "edited");
        assert_eq!(v["kind"], "weekly");
    }
}
