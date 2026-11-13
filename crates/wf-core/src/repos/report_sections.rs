//! The `report_sections` repository as Rust-planned queries, with its row mapping.
//!
//! Ported from `PostgrestReportSectionRepository` and `report-section-rows` in
//! `apps/web/src/features/report/infrastructure/parts.ts`. The outline tree is
//! [`build_section_tree`]. Titles are end-to-end encrypted, so `titleContains` has
//! no server filter: the decrypting repository filters after the read.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::reader_analysis::lines::js_trim;
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::report::report_section::{
    NewReportSectionInput, ReportSection, ReportStatus, build_section_tree, create_report_section,
};
use crate::text::count_words;

const TABLE: &str = "report_sections";

/// The columns a [`ReportSectionRow`] is read as, named rather than starred.
pub const REPORT_SECTION_COLUMNS: &str = "id,title,section_no,parent_id,status,word_count,target_words,deadline,draft_url,notes,sort_order,created_at,updated_at";

/// A `report_sections` row as read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[allow(missing_docs)]
pub struct ReportSectionRow {
    pub id: String,
    pub title: String,
    pub section_no: Option<String>,
    pub parent_id: Option<String>,
    pub status: ReportStatus,
    pub word_count: f64,
    pub target_words: Option<f64>,
    pub deadline: Option<String>,
    pub draft_url: Option<String>,
    pub notes: Option<String>,
    pub sort_order: f64,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// The domain section for a stored row (`reportSectionToDomain`).
#[must_use]
pub fn to_domain(row: &ReportSectionRow) -> ReportSection {
    ReportSection {
        id: row.id.clone(),
        title: row.title.clone(),
        section_no: row.section_no.clone(),
        parent_id: row.parent_id.clone(),
        status: row.status,
        word_count: row.word_count,
        target_words: row.target_words,
        deadline: row.deadline.clone(),
        draft_url: row.draft_url.clone(),
        notes: row.notes.clone(),
        sort_order: row.sort_order,
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    }
}

/// The row a section is written as (`reportSectionToRow`). `updated_at` is the database's.
#[must_use]
pub fn to_row(s: &ReportSection) -> Value {
    json!({
        "id": s.id,
        "title": s.title,
        "section_no": s.section_no,
        "parent_id": s.parent_id,
        "status": s.status,
        "word_count": s.word_count,
        "target_words": s.target_words,
        "deadline": s.deadline,
        "draft_url": s.draft_url,
        "notes": s.notes,
        "sort_order": s.sort_order,
        "created_at": s.created_at,
    })
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "getTree" => get_tree(call),
        "save" => save(call),
        "delete" | "remove" => delete(call),
        "add" => add(call),
        "setTitle" => set_title(call),
        "setParent" => set_parent(call),
        "setStatus" => set_status(call),
        "setProgress" => set_progress(call),
        "setNotes" => set_notes(call),
        _ => return None,
    })
}

/// `ReportSectionFilter`, minus `titleContains`. `parentId: null` means top level;
/// an absent `parentId` means any parent.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default)]
    status: Option<ReportStatus>,
    #[serde(default, deserialize_with = "present")]
    parent_id: Option<Option<String>>,
}

/// Keeps an explicit `null` apart from an absent field.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// The project's sections, unordered.
fn project_select(call: &RepoCall) -> RepoQuery {
    let q = RepoQuery::select(TABLE, REPORT_SECTION_COLUMNS);
    match call.ctx.project_id.as_deref() {
        Some(pid) => q.eq("project_id", pid),
        None => q,
    }
}

/// `getById(id)`: the section, or `null`.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, REPORT_SECTION_COLUMNS)
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ReportSectionRow>| {
        row.as_ref().map(to_domain)
    })
}

/// `list(filter?)`: by sort order, then section number.
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
    let mut q = project_select(call);
    if let Some(status) = filter.status {
        q = q.eq("status", json!(status));
    }
    match filter.parent_id {
        Some(Some(parent)) => q = q.eq("parent_id", parent),
        Some(None) => q = q.filter("is", "parent_id", Value::Null),
        None => {}
    }
    RepoStep::send(q.order("sort_order", true).order("section_no", true))
}

/// `getTree()`: the project's outline.
fn get_tree(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(project_select(call));
    }
    match call.reply::<Vec<ReportSectionRow>>(0) {
        Some(Ok(rows)) => RepoStep::done(&build_section_tree(rows.iter().map(to_domain).collect())),
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `add(input)`: builds the section with `call.id(0)` and the sender's clock, then saves it.
/// Validation fails before anything is sent. The result is the section once the save replies.
fn add(call: &RepoCall) -> RepoStep {
    let input: NewReportSectionInput = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    let section = match create_report_section(&input, &call.id(0), call.now()) {
        Ok(section) => section,
        Err(e) => return RepoStep::fail_named("ReportSectionValidationError", e),
    };
    let value = match serde_json::to_value(&section) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], 0));
    if call.replies.is_empty() || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&section)
}

/// `setTitle(id, title)`: renames in place, trimmed. A blank title fails before anything is read.
fn set_title(call: &RepoCall) -> RepoStep {
    let title = js_trim(call.text(1));
    if title.is_empty() {
        return RepoStep::fail_named("ReportSectionValidationError", "Section title is required.");
    }
    mutate(call, 0, call.text(0), |s| ReportSection {
        title: title.to_owned(),
        ..s.clone()
    })
}

/// `setParent(id, parentId)`: moves under `parentId`, or to the top when `null`. A move under a
/// parent first walks up from the parent (see [`assert_not_under`]), then reads and saves.
fn set_parent(call: &RepoCall) -> RepoStep {
    let parent: Option<String> = match call.parse(1) {
        Ok(parent) => parent,
        Err(e) => return RepoStep::fail(e),
    };
    let reads = match parent.as_deref() {
        Some(parent) => match assert_not_under(call, call.text(0), parent) {
            Ok(reads) => reads,
            Err(step) => return step,
        },
        None => 0,
    };
    mutate(call, reads, call.text(0), |s| ReportSection {
        parent_id: parent.clone(),
        ..s.clone()
    })
}

/// The walk of TS `assertNotUnder`: climbs from `new_parent` through `getById` reads. Reaching
/// `id` fails. A loop already in the data ends the walk quietly. Returns how many reads it used,
/// so the move's own reads come after them.
fn assert_not_under(call: &RepoCall, id: &str, new_parent: &str) -> Result<usize, RepoStep> {
    let mut cursor = new_parent.to_owned();
    let mut seen = HashSet::new();
    let mut reads = 0;
    while !cursor.is_empty() {
        if cursor == id {
            return Err(RepoStep::fail_named(
                "ReportSectionValidationError",
                "A section cannot be moved inside itself.",
            ));
        }
        if !seen.insert(cursor.clone()) {
            return Ok(reads);
        }
        let value = match get_by_id(&call.sub(vec![json!(cursor)], reads)) {
            RepoStep::Done { value } => value,
            other => return Err(other),
        };
        let node: Option<ReportSection> = match serde_json::from_value(value) {
            Ok(node) => node,
            Err(e) => return Err(RepoStep::fail(e)),
        };
        let Some(node) = node else {
            return Err(RepoStep::fail_named(
                "NotFoundError",
                format!("No report section with id \"{new_parent}\"."),
            ));
        };
        reads += 1;
        cursor = node.parent_id.unwrap_or_default();
    }
    Ok(reads)
}

/// `setStatus(id, status)`: changes only the status.
fn set_status(call: &RepoCall) -> RepoStep {
    let status: ReportStatus = match call.parse(1) {
        Ok(status) => status,
        Err(e) => return RepoStep::fail(e),
    };
    mutate(call, 0, call.text(0), |s| ReportSection {
        status,
        ..s.clone()
    })
}

/// `setProgress(id, wordCount)`: sets the word count; negatives fail before anything is read.
fn set_progress(call: &RepoCall) -> RepoStep {
    let word_count: f64 = match call.parse(1) {
        Ok(n) => n,
        Err(e) => return RepoStep::fail(e),
    };
    if word_count < 0.0 {
        return RepoStep::fail_named(
            "ReportSectionValidationError",
            "Word count cannot be negative.",
        );
    }
    mutate(call, 0, call.text(0), |s| ReportSection {
        word_count,
        ..s.clone()
    })
}

/// `setNotes(id, notes)`: persists the body (blank clears it) and keeps `wordCount` in sync.
fn set_notes(call: &RepoCall) -> RepoStep {
    let raw = call.text(1);
    let text = if js_trim(raw).is_empty() { "" } else { raw };
    let notes = (!text.is_empty()).then(|| text.to_owned());
    let word_count = count_words(text) as f64;
    mutate(call, 0, call.text(0), |s| ReportSection {
        notes: notes.clone(),
        word_count,
        ..s.clone()
    })
}

/// Read section `id` at reply `skip`, apply `change`, save it, and finish with the updated
/// section. `getById` and `save` run with `call.sub`. A missing section fails as NotFound.
fn mutate(
    call: &RepoCall,
    skip: usize,
    id: &str,
    change: impl Fn(&ReportSection) -> ReportSection,
) -> RepoStep {
    let value = match get_by_id(&call.sub(vec![json!(id)], skip)) {
        RepoStep::Done { value } => value,
        other => return other,
    };
    let existing: Option<ReportSection> = match serde_json::from_value(value) {
        Ok(existing) => existing,
        Err(e) => return RepoStep::fail(e),
    };
    let Some(existing) = existing else {
        return RepoStep::fail_named(
            "NotFoundError",
            format!("No report section with id \"{id}\"."),
        );
    };
    let updated = change(&existing);
    let value = match serde_json::to_value(&updated) {
        Ok(value) => value,
        Err(e) => return RepoStep::fail(e),
    };
    let saved = save(&call.sub(vec![value], skip + 1));
    if call.replies.len() < skip + 2 || matches!(saved, RepoStep::Fail { .. }) {
        return saved;
    }
    RepoStep::done(&updated)
}

/// `save(section)`: upsert, stamped with the open project when there is one.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let section: ReportSection = match call.parse(0) {
        Ok(section) => section,
        Err(e) => return RepoStep::fail(e),
    };
    let mut row = to_row(&section);
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

    const NOW: &str = "2026-11-12T09:00:00.000Z";

    fn call(args: Vec<Value>, replies: Vec<Value>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: Some("p1".into()),
                id_seed: Some("seed".into()),
                now: Some(NOW.into()),
                ..RepoCtx::default()
            },
        }
    }

    fn fail(step: RepoStep) -> (String, Option<String>) {
        match step {
            RepoStep::Fail { message, name } => (message, name),
            other => panic!("expected fail, got {other:?}"),
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

    fn row(id: &str, parent: Option<&str>, sort: f64) -> Value {
        json!({ "id": id, "title": id, "section_no": null, "parent_id": parent,
            "status": "drafting", "word_count": 10, "target_words": null, "deadline": null,
            "draft_url": null, "notes": null, "sort_order": sort,
            "created_at": "2026-11-01T10:00:00Z", "updated_at": null })
    }

    #[test]
    fn list_filters_status_and_parent_in_outline_order() {
        let filter = json!({ "status": "review", "parentId": "s1", "titleContains": "x" });
        let q = sent(list(&call(vec![filter], vec![])));
        let cols: Vec<_> = q.filters.iter().map(|f| f.column.as_str()).collect();
        assert_eq!(cols, ["project_id", "status", "parent_id"]);
        assert_eq!(q.filters[1].value, json!("review"));
        assert_eq!(q.order[0].column, "sort_order");
        assert!(q.order[0].ascending);
        assert_eq!(q.order[1].column, "section_no");
    }

    #[test]
    fn a_null_parent_means_top_level_and_absent_means_any() {
        let q = sent(list(&call(vec![json!({ "parentId": null })], vec![])));
        assert_eq!(q.filters[1].op, "is");
        assert_eq!(q.filters[1].value, Value::Null);
        let q = sent(list(&call(vec![json!({})], vec![])));
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn rows_map_nulls_to_absent_fields() {
        let v = done(list(&call(vec![], vec![json!([row("s1", None, 1.0)])])));
        assert_eq!(v[0]["wordCount"], 10.0);
        assert!(v[0].get("parentId").is_none());
        assert!(v[0].get("updatedAt").is_none());
    }

    #[test]
    fn get_tree_nests_children_under_parents() {
        let q = sent(get_tree(&call(vec![], vec![])));
        assert_eq!(q.filters[0].column, "project_id");
        let rows = json!([row("c", Some("p"), 1.0), row("p", None, 0.0)]);
        let v = done(get_tree(&call(vec![], vec![rows])));
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["children"][0]["section"]["id"], "c");
    }

    #[test]
    fn get_by_id_maps_a_missing_row_to_null() {
        let none = get_by_id(&call(vec![json!("s1")], vec![Value::Null]));
        assert_eq!(done(none), Value::Null);
    }

    #[test]
    fn save_writes_nulls_and_the_project() {
        let section = json!({ "id": "s1", "title": "Intro", "status": "not_started",
            "wordCount": 0, "sortOrder": 0, "createdAt": "2026-11-01T10:00:00Z",
            "updatedAt": "2026-11-02T10:00:00Z" });
        let q = sent(save(&call(vec![section], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["parent_id"], Value::Null);
        assert!(body.get("updated_at").is_none());
    }

    #[test]
    fn add_saves_the_new_section_with_the_project_and_seeded_id() {
        let id = call(vec![], vec![]).id(0);
        let input = json!({ "title": "  Intro  " });
        let q = sent(add(&call(vec![input.clone()], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.expect("body");
        assert_eq!(body["id"], id);
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["title"], "Intro");
        let v = done(add(&call(vec![input], vec![json!(null)])));
        assert_eq!(v["id"], id);
        assert_eq!(v["createdAt"], NOW);
    }

    #[test]
    fn add_rejects_a_blank_title_and_a_negative_count() {
        let (msg, name) = fail(add(&call(vec![json!({ "title": "  " })], vec![])));
        assert_eq!(msg, "Section title is required.");
        assert_eq!(name.as_deref(), Some("ReportSectionValidationError"));
        let (msg, _) = fail(add(&call(
            vec![json!({ "title": "x", "wordCount": -1 })],
            vec![],
        )));
        assert_eq!(msg, "Word count cannot be negative.");
    }

    #[test]
    fn set_status_changes_only_the_status() {
        let args = vec![json!("s1"), json!("review")];
        let q = sent(set_status(&call(args.clone(), vec![])));
        assert_eq!(q.filters[0].column, "id");
        let q = sent(set_status(&call(args.clone(), vec![row("s1", None, 1.0)])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.body.expect("body")["status"], "review");
        let v = done(set_status(&call(
            args,
            vec![row("s1", None, 1.0), Value::Null],
        )));
        assert_eq!(v["status"], "review");
        assert_eq!(v["title"], "s1");
        assert_eq!(v["wordCount"], 10.0);
    }

    #[test]
    fn set_status_rejects_an_unknown_id() {
        let args = vec![json!("nope"), json!("review")];
        let (msg, name) = fail(set_status(&call(args, vec![Value::Null])));
        assert_eq!(msg, "No report section with id \"nope\".");
        assert_eq!(name.as_deref(), Some("NotFoundError"));
    }

    #[test]
    fn set_progress_sets_the_count_and_rejects_negatives() {
        let (msg, _) = fail(set_progress(&call(vec![json!("s1"), json!(-1)], vec![])));
        assert_eq!(msg, "Word count cannot be negative.");
        let replies = vec![row("s1", None, 1.0), Value::Null];
        let v = done(set_progress(&call(vec![json!("s1"), json!(120)], replies)));
        assert_eq!(v["wordCount"], 120.0);
    }

    #[test]
    fn set_notes_keeps_the_word_count_in_step_with_the_text() {
        let replies = vec![row("s1", None, 1.0), Value::Null];
        let v = done(set_notes(&call(
            vec![json!("s1"), json!("one two  three")],
            replies,
        )));
        assert_eq!(v["wordCount"], 3.0);
        assert_eq!(v["notes"], "one two  three");
        let replies = vec![row("s1", None, 1.0), Value::Null];
        let v = done(set_notes(&call(vec![json!("s1"), json!("  \n ")], replies)));
        assert_eq!(v["wordCount"], 0.0);
        assert!(v["notes"].is_null());
    }

    #[test]
    fn set_title_renames_and_rejects_a_blank_title() {
        let (msg, name) = fail(set_title(&call(vec![json!("s1"), json!("   ")], vec![])));
        assert_eq!(msg, "Section title is required.");
        assert_eq!(name.as_deref(), Some("ReportSectionValidationError"));
        let replies = vec![row("s1", None, 1.0), Value::Null];
        let v = done(set_title(&call(
            vec![json!("s1"), json!("  Renamed ")],
            replies,
        )));
        assert_eq!(v["title"], "Renamed");
    }

    #[test]
    fn set_parent_nests_under_an_existing_section() {
        let args = vec![json!("s1"), json!("p")];
        let q = sent(set_parent(&call(args.clone(), vec![])));
        assert_eq!(q.filters[0].value, json!("p"));
        let q = sent(set_parent(&call(args.clone(), vec![row("p", None, 0.0)])));
        assert_eq!(q.filters[0].value, json!("s1"));
        let replies = vec![row("p", None, 0.0), row("s1", None, 1.0), Value::Null];
        let v = done(set_parent(&call(args, replies)));
        assert_eq!(v["parentId"], "p");
    }

    #[test]
    fn set_parent_null_clears_the_parent_without_reading_others() {
        let args = vec![json!("s1"), Value::Null];
        let q = sent(set_parent(&call(args.clone(), vec![])));
        assert_eq!(q.filters[0].value, json!("s1"));
        let v = done(set_parent(&call(
            args,
            vec![row("s1", Some("p"), 1.0), Value::Null],
        )));
        assert!(v["parentId"].is_null());
    }

    #[test]
    fn set_parent_refuses_a_move_inside_itself_or_a_descendant() {
        let (msg, name) = fail(set_parent(&call(vec![json!("s1"), json!("s1")], vec![])));
        assert_eq!(msg, "A section cannot be moved inside itself.");
        assert_eq!(name.as_deref(), Some("ReportSectionValidationError"));
        // s2 sits under s1, so moving s1 under s2 would close a loop.
        let replies = vec![row("s2", Some("s1"), 1.0)];
        let (msg, _) = fail(set_parent(&call(vec![json!("s1"), json!("s2")], replies)));
        assert_eq!(msg, "A section cannot be moved inside itself.");
    }

    #[test]
    fn set_parent_refuses_a_missing_parent_and_names_the_requested_one() {
        let args = vec![json!("s1"), json!("p")];
        let (msg, name) = fail(set_parent(&call(args.clone(), vec![Value::Null])));
        assert_eq!(msg, "No report section with id \"p\".");
        assert_eq!(name.as_deref(), Some("NotFoundError"));
        // The missing ancestor is q, but the message names the requested parent p.
        let replies = vec![row("p", Some("q"), 1.0), Value::Null];
        let (msg, _) = fail(set_parent(&call(args, replies)));
        assert_eq!(msg, "No report section with id \"p\".");
    }

    #[test]
    fn set_parent_still_moves_under_a_loop_already_in_the_data() {
        // p and q already point at each other; the walk ends at the repeat, not in an error.
        let args = vec![json!("s1"), json!("p")];
        let replies = vec![
            row("p", Some("q"), 1.0),
            row("q", Some("p"), 2.0),
            row("s1", None, 3.0),
            Value::Null,
        ];
        let v = done(set_parent(&call(args, replies)));
        assert_eq!(v["parentId"], "p");
    }

    #[test]
    fn remove_deletes_the_section() {
        let q = sent(step("remove", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
    }

    #[test]
    fn delete_targets_the_id() {
        let q = sent(step("delete", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
    }
}
