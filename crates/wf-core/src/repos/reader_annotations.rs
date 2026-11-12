//! The `reader_annotations` row queries, Rust-planned.
//!
//! Ported from `PostgrestReaderAnnotationRepository` in
//! `apps/web/src/features/reader/infrastructure/parts-1.ts`. The row mapping is
//! `reader::annotation_rows::to_domain`. `IndexedDbPdfByteCache` in the same file stays in TS.
//! Reads with no project selected return `[]`; writes fail with
//! "Select a project before managing reader annotations.".

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::reader::annotation::is_reader_annotation_type;
use crate::reader::annotation_helpers::ReaderAnnotation;
use crate::reader::annotation_rows::{ReaderAnnotationRow, to_domain};
use crate::reader::viewport::build_annotation_sort_index;
use crate::reader::zotero_projection::DEFAULT_ANNOTATION_COLOR;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

const TABLE: &str = "reader_annotations";
const ACTION: &str = "managing reader annotations";

/// The columns a reader annotation row is read as, named rather than starred.
pub const READER_ANNOTATION_COLUMNS: &str = "id,paper_id,origin,zotero_key,type,color,text,comment,tags,anchor,page_index,sort_index,sync_state,zotero_version,created_at,updated_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "list" => list(call),
        "listForProject" => list_for_project(call),
        "create" => create(call),
        "update" => update(call),
        "recordZoteroSync" => record_zotero_sync(call),
        "remove" => remove(call),
        _ => return None,
    })
}

/// The selected project, when non-empty.
fn project_id(call: &RepoCall) -> Option<&str> {
    call.ctx.project_id.as_deref().filter(|id| !id.is_empty())
}

/// A step that finishes with `result`, or fails with its error.
fn done_or_fail<T: Serialize>(result: Result<T, String>) -> RepoStep {
    match result {
        Ok(value) => RepoStep::done(&value),
        Err(e) => RepoStep::fail(e),
    }
}

/// Maps reply `i` (rows) with `f`, failing on the first row that does not map.
fn map_annotations<D: Serialize>(
    call: &RepoCall,
    i: usize,
    f: fn(ReaderAnnotationRow) -> Result<D, String>,
) -> RepoStep {
    match call.reply::<Vec<ReaderAnnotationRow>>(i) {
        Some(Ok(rows)) => done_or_fail(rows.into_iter().map(f).collect::<Result<Vec<D>, String>>()),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail(format!("reply {i} missing")),
    }
}

/// Maps reply `i` (one row) to the domain annotation.
fn one_annotation(call: &RepoCall, i: usize) -> RepoStep {
    match call.reply::<ReaderAnnotationRow>(i) {
        Some(Ok(row)) => done_or_fail(to_domain(row)),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail(format!("reply {i} missing")),
    }
}

/// An annotation with the paper and page it sits on, for the search index.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAnnotation {
    #[serde(flatten)]
    annotation: ReaderAnnotation,
    paper_id: String,
    page_index: f64,
}

fn workspace_annotation(row: ReaderAnnotationRow) -> Result<WorkspaceAnnotation, String> {
    let paper_id = row.paper_id.clone();
    let page_index = row.page_index;
    Ok(WorkspaceAnnotation {
        annotation: to_domain(row)?,
        paper_id,
        page_index,
    })
}

/// `list(paperId)`: the paper's annotations in reading order, `[]` without a project.
fn list(call: &RepoCall) -> RepoStep {
    let Some(project) = project_id(call) else {
        return RepoStep::done(&Vec::<ReaderAnnotation>::new());
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, READER_ANNOTATION_COLUMNS)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .order("sort_index", true),
        );
    }
    map_annotations(call, 0, to_domain)
}

/// `listForProject()`: every annotation in the project, `[]` without a project.
fn list_for_project(call: &RepoCall) -> RepoStep {
    let Some(project) = project_id(call) else {
        return RepoStep::done(&Vec::<WorkspaceAnnotation>::new());
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, READER_ANNOTATION_COLUMNS)
                .eq("project_id", project)
                .order("sort_index", true),
        );
    }
    map_annotations(call, 0, workspace_annotation)
}

/// The draft's sort index, or one built from its page.
fn sort_index(draft: &Value, page_index: f64) -> String {
    draft
        .get("sortIndex")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map_or_else(
            || build_annotation_sort_index(page_index, 0.0, 0.0),
            str::to_owned,
        )
}

/// `create(paperId, draft)`: a local row, `sync_state` `local`.
fn create(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return one_annotation(call, 0);
    }
    let draft = call.arg(1);
    let kind = draft
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !is_reader_annotation_type(kind) {
        return RepoStep::fail(format!("Invalid annotation type: {kind}"));
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let page_index = draft
        .get("pageIndex")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    let sort_index = sort_index(draft, page_index);
    let text_of = |key: &str| {
        draft
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    let color = match text_of("color") {
        color if color.is_empty() => DEFAULT_ANNOTATION_COLOR.to_owned(),
        color => color,
    };
    let mut body = json!({
        "user_id": user,
        "project_id": project,
        "paper_id": call.text(0),
        "origin": "local",
        "type": kind,
        "color": color,
        "text": text_of("text"),
        "comment": text_of("comment"),
        "tags": draft.get("tags").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!([])),
        "anchor": draft.get("anchor").cloned().unwrap_or(Value::Null),
        "page_index": page_index,
        "sort_index": sort_index,
        "sync_state": "local",
    });
    if let Some(id) = draft
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    {
        body["id"] = json!(id);
    }
    RepoStep::send(
        RepoQuery::insert(TABLE, body)
            .returning(READER_ANNOTATION_COLUMNS)
            .single(),
    )
}

/// The patch keys that are set, as stored columns; colour and text are trimmed.
fn patch_fields(patch: &Value) -> Map<String, Value> {
    let trimmed = |key: &str| {
        patch
            .get(key)
            .map(|v| v.as_str().unwrap_or_default().trim().to_owned())
    };
    let mut updates = Map::new();
    if let Some(color) = trimmed("color") {
        let color = if color.is_empty() {
            DEFAULT_ANNOTATION_COLOR.to_owned()
        } else {
            color
        };
        let _ = updates.insert("color".into(), json!(color));
    }
    if let Some(text) = trimmed("text") {
        let _ = updates.insert("text".into(), json!(text));
    }
    if let Some(comment) = trimmed("comment") {
        let _ = updates.insert("comment".into(), json!(comment));
    }
    for (key, column) in [
        ("tags", "tags"),
        ("anchor", "anchor"),
        ("sortIndex", "sort_index"),
    ] {
        if let Some(value) = patch.get(key) {
            let _ = updates.insert(column.into(), value.clone());
        }
    }
    updates
}

/// `update(id, patch)`: a row with a Zotero counterpart is flagged `pending` in the same
/// write; otherwise the plain write runs.
fn update(call: &RepoCall) -> RepoStep {
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let id = call.text(0);
    let updates = patch_fields(call.arg(1));
    match call.replies.len() {
        0 => {
            let mut flagged = updates.clone();
            let _ = flagged.insert("sync_state".into(), json!("pending"));
            RepoStep::send(
                RepoQuery::update(TABLE, Value::Object(flagged))
                    .eq("id", id)
                    .eq("project_id", project)
                    .filter("not", "zotero_key", json!(["is", Value::Null]))
                    .returning(READER_ANNOTATION_COLUMNS)
                    .maybe_single(),
            )
        }
        1 => match call.reply::<Option<ReaderAnnotationRow>>(0) {
            Some(Ok(Some(row))) => done_or_fail(to_domain(row)),
            Some(Ok(None)) => RepoStep::send(
                RepoQuery::update(TABLE, Value::Object(updates))
                    .eq("id", id)
                    .eq("project_id", project)
                    .returning(READER_ANNOTATION_COLUMNS)
                    .single(),
            ),
            Some(Err(e)) => RepoStep::fail(e),
            None => RepoStep::fail("reply 0 missing"),
        },
        _ => one_annotation(call, 1),
    }
}

/// `recordZoteroSync(id, record)`: write-back bookkeeping; only the keys the record gives.
fn record_zotero_sync(call: &RepoCall) -> RepoStep {
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let record = call.arg(1);
    let mut body = Map::new();
    for (key, column) in [
        ("zoteroKey", "zotero_key"),
        ("zoteroVersion", "zotero_version"),
        ("syncState", "sync_state"),
    ] {
        if let Some(value) = record.get(key) {
            let _ = body.insert(column.into(), value.clone());
        }
    }
    RepoStep::send(
        RepoQuery::update(TABLE, Value::Object(body))
            .eq("id", call.text(0))
            .eq("project_id", project),
    )
}

/// `remove(id)`.
fn remove(call: &RepoCall) -> RepoStep {
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    RepoStep::send(
        RepoQuery::delete(TABLE)
            .eq("id", call.text(0))
            .eq("project_id", project),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx, RepoSingle};

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                user_id: Some("u1".into()),
                ..RepoCtx::default()
            },
        }
    }

    fn no_project(args: Vec<Value>) -> RepoCall {
        let mut c = call(args, vec![]);
        c.ctx.project_id = None;
        c
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

    fn fail_message(step: RepoStep) -> String {
        match step {
            RepoStep::Fail { message, .. } => message,
            other => panic!("expected fail, got {other:?}"),
        }
    }

    #[allow(clippy::needless_pass_by_value)]
    fn has_filter(q: &RepoQuery, op: &str, column: &str, value: Value) -> bool {
        q.filters
            .iter()
            .any(|f| f.op == op && f.column == column && f.value == value)
    }

    fn no_project_message() -> &'static str {
        "Select a project before managing reader annotations."
    }

    #[allow(clippy::needless_pass_by_value)]
    fn row(id: &str, paper: &str, zotero_key: Value, sync: Value) -> Value {
        json!({
            "id": id, "paper_id": paper, "origin": "local", "zotero_key": zotero_key,
            "type": "highlight", "color": "#ffd400", "text": "quote", "comment": "note",
            "tags": null, "anchor": null, "page_index": 3.0, "sort_index": "0003|000|000",
            "sync_state": sync, "zotero_version": null,
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z"
        })
    }

    fn draft() -> Value {
        json!({
            "type": "highlight", "color": " ", "text": " quote ", "pageIndex": 3,
            "anchor": { "x": 1 }, "sortIndex": "", "tags": null
        })
    }

    #[test]
    fn step_routes_known_methods_only() {
        assert!(step("list", &call(vec![json!("p")], vec![])).is_some());
        assert!(step("listForProject", &call(vec![], vec![])).is_some());
        assert!(step("bogus", &call(vec![], vec![])).is_none());
    }

    #[test]
    fn list_reads_the_paper_in_reading_order_and_is_empty_without_a_project() {
        assert_eq!(done(list(&no_project(vec![json!("paper1")]))), json!([]));
        let q = sent(list(&call(vec![json!("paper1")], vec![])));
        assert_eq!(q.table, TABLE);
        assert_eq!(q.columns.as_deref(), Some(READER_ANNOTATION_COLUMNS));
        assert!(has_filter(&q, "eq", "project_id", json!("p1")));
        assert!(has_filter(&q, "eq", "paper_id", json!("paper1")));
        assert_eq!(q.order[0].column, "sort_index");
        assert!(q.order[0].ascending);
        let v = done(list(&call(
            vec![json!("paper1")],
            vec![json!([row("a1", "paper1", Value::Null, Value::Null)])],
        )));
        assert_eq!(v[0]["id"], "a1");
        assert_eq!(v[0]["type"], "highlight");
        assert_eq!(v[0]["syncState"], "local");
    }

    #[test]
    fn list_for_project_adds_paper_and_page() {
        assert_eq!(done(list_for_project(&no_project(vec![]))), json!([]));
        let q = sent(list_for_project(&call(vec![], vec![])));
        assert_eq!(q.filters.len(), 1);
        assert!(has_filter(&q, "eq", "project_id", json!("p1")));
        let v = done(list_for_project(&call(
            vec![],
            vec![json!([row("a1", "paper9", json!("K1"), json!("pending"))])],
        )));
        assert_eq!(v[0]["paperId"], "paper9");
        assert_eq!(v[0]["pageIndex"], json!(3.0));
        assert_eq!(v[0]["zoteroKey"], "K1");
    }

    #[test]
    fn create_checks_type_user_and_project_before_writing() {
        let mut bad = draft();
        bad["type"] = json!("strikeout");
        assert_eq!(
            fail_message(create(&call(vec![json!("paper1"), bad], vec![]))),
            "Invalid annotation type: strikeout"
        );
        let mut anon = call(vec![json!("paper1"), draft()], vec![]);
        anon.ctx.user_id = None;
        assert_eq!(fail_message(create(&anon)), "Not signed in.");
        assert_eq!(
            fail_message(create(&no_project(vec![json!("paper1"), draft()]))),
            no_project_message()
        );
    }

    #[test]
    fn create_inserts_a_local_row_with_defaults() {
        let q = sent(create(&call(vec![json!("paper1"), draft()], vec![])));
        assert_eq!(q.action, RepoAction::Insert);
        assert_eq!(q.single, RepoSingle::One);
        assert_eq!(q.columns.as_deref(), Some(READER_ANNOTATION_COLUMNS));
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["paper_id"], "paper1");
        assert_eq!(body["color"], DEFAULT_ANNOTATION_COLOR);
        assert_eq!(body["text"], "quote");
        assert_eq!(body["comment"], "");
        assert_eq!(body["tags"], json!([]));
        assert_eq!(
            body["sort_index"],
            build_annotation_sort_index(3.0, 0.0, 0.0)
        );
        assert_eq!(body["sync_state"], "local");
        assert!(body.get("id").is_none());
        let v = done(create(&call(
            vec![json!("paper1"), draft()],
            vec![row("a1", "paper1", Value::Null, Value::Null)],
        )));
        assert_eq!(v["id"], "a1");
    }

    #[test]
    fn update_flags_a_zotero_linked_row_pending_in_one_write() {
        let patch = json!({ "text": " edited ", "color": "", "sortIndex": "0001" });
        let q = sent(update(&call(vec![json!("a1"), patch.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Update);
        assert!(has_filter(&q, "eq", "id", json!("a1")));
        assert!(has_filter(&q, "eq", "project_id", json!("p1")));
        assert!(has_filter(
            &q,
            "not",
            "zotero_key",
            json!(["is", Value::Null])
        ));
        assert_eq!(q.single, RepoSingle::Maybe);
        let body = q.body.unwrap();
        assert_eq!(body["sync_state"], "pending");
        assert_eq!(body["text"], "edited");
        assert_eq!(body["color"], DEFAULT_ANNOTATION_COLOR);
        assert_eq!(body["sort_index"], "0001");
        // The flagged write found no Zotero-linked row: the plain write runs without the flag.
        let plain = sent(update(&call(
            vec![json!("a1"), patch.clone()],
            vec![Value::Null],
        )));
        assert!(plain.body.unwrap().get("sync_state").is_none());
        // The flagged write answered with the row: done, no second write.
        let v = done(update(&call(
            vec![json!("a1"), patch.clone()],
            vec![row("a1", "paper1", json!("K1"), json!("pending"))],
        )));
        assert_eq!(v["syncState"], "pending");
        let v = done(update(&call(
            vec![json!("a1"), patch],
            vec![Value::Null, row("a1", "paper1", Value::Null, Value::Null)],
        )));
        assert_eq!(v["id"], "a1");
    }

    #[test]
    fn update_needs_a_project() {
        assert_eq!(
            fail_message(update(&no_project(vec![json!("a1"), json!({})]))),
            no_project_message()
        );
    }

    #[test]
    fn record_zotero_sync_writes_the_bookkeeping_keys() {
        let record = json!({ "zoteroKey": "K1", "zoteroVersion": 4, "syncState": "synced" });
        let q = sent(record_zotero_sync(&call(
            vec![json!("a1"), record.clone()],
            vec![],
        )));
        assert_eq!(q.action, RepoAction::Update);
        assert!(has_filter(&q, "eq", "id", json!("a1")));
        assert!(has_filter(&q, "eq", "project_id", json!("p1")));
        let body = q.body.unwrap();
        assert_eq!(body["zotero_key"], "K1");
        assert_eq!(body["zotero_version"], 4);
        assert_eq!(body["sync_state"], "synced");
        assert_eq!(
            record_zotero_sync(&call(vec![json!("a1"), record], vec![Value::Null])),
            RepoStep::unit()
        );
        assert_eq!(
            fail_message(record_zotero_sync(&no_project(vec![
                json!("a1"),
                json!({})
            ]))),
            no_project_message()
        );
    }

    #[test]
    fn remove_deletes_the_row_in_the_project() {
        let q = sent(remove(&call(vec![json!("a1")], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        assert!(has_filter(&q, "eq", "id", json!("a1")));
        assert!(has_filter(&q, "eq", "project_id", json!("p1")));
        assert_eq!(
            remove(&call(vec![json!("a1")], vec![Value::Null])),
            RepoStep::unit()
        );
        assert_eq!(
            fail_message(remove(&no_project(vec![json!("a1")]))),
            no_project_message()
        );
    }
}
