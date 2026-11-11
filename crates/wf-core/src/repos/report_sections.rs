//! The `report_sections` repository as Rust-planned queries, with its row mapping.
//!
//! Ported from `PostgrestReportSectionRepository` and `report-section-rows` in
//! `apps/web/src/features/report/infrastructure/parts.ts`. The outline tree is
//! [`build_section_tree`]. Titles are end-to-end encrypted, so `titleContains` has
//! no server filter: the decrypting repository filters after the read.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};
use crate::report::report_section::{ReportSection, ReportStatus, build_section_tree};

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
        "delete" => delete(call),
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
    fn delete_targets_the_id() {
        let q = sent(step("delete", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
    }
}
