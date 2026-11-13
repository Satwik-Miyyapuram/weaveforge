//! The `annotation_pins` repository as Rust-planned queries.
//!
//! Ported from `PostgrestAnnotationPinRepository` in
//! `apps/web/src/features/papers/infrastructure/parts-1.ts`. Rows map with
//! [`annotation_pin::to_domain`]. `PaperImageStore` (blob storage) stays in TS.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::papers::annotation_pin::{AnnotationPin, AnnotationPinRow, to_domain as pin_to_domain};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "annotation_pins";
const ACTION: &str = "managing annotation pins";

/// The columns an [`AnnotationPinRow`] is read as, named rather than starred.
pub const PIN_COLUMNS: &str = "id,paper_id,annotation_key,report_section_id,created_at";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "save" => save(call),
        "remove" => remove(call),
        "listForProject" => list(call, None),
        "listForPaper" => list(call, Some(("paper_id", call.text(0)))),
        "listForSection" => list(call, Some(("report_section_id", call.text(0)))),
        _ => return None,
    })
}

fn to_domain(row: &AnnotationPinRow) -> AnnotationPin {
    pin_to_domain(row.clone())
}

/// `SaveAnnotationPinInput`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewPin {
    paper_id: String,
    annotation_key: String,
    report_section_id: String,
}

/// `save(input)`: upsert on (project, paper, annotation) and return the stored pin.
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_row(call, 0, to_domain);
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let input: NewPin = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            TABLE,
            json!({
                "user_id": user,
                "project_id": project,
                "paper_id": input.paper_id,
                "annotation_key": input.annotation_key,
                "report_section_id": input.report_section_id,
            }),
        )
        .on_conflict("project_id,paper_id,annotation_key", false)
        .returning(PIN_COLUMNS)
        .single(),
    )
}

/// `remove(paperId, annotationKey)`.
fn remove(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.project(ACTION) {
        Ok(project) => RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .eq("annotation_key", call.text(1)),
        ),
        Err(step) => step,
    }
}

/// `listForProject()`, `listForPaper(paperId)` and `listForSection(reportSectionId)`: oldest
/// first; none without a project. An empty filter value adds no filter, as the TS does.
fn list(call: &RepoCall, filter: Option<(&str, &str)>) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_domain);
    }
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(project) => {
            let mut query = RepoQuery::select(TABLE, PIN_COLUMNS).eq("project_id", project);
            if let Some((column, value)) = filter.filter(|(_, value)| !value.is_empty()) {
                query = query.eq(column, value);
            }
            RepoStep::send(query.order("created_at", true))
        }
        None => RepoStep::done(&Vec::<Value>::new()),
    }
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
        json!({ "id": "a1", "paper_id": "pa", "annotation_key": "k1",
            "report_section_id": "s1", "created_at": "2026-11-01T10:00:00Z" })
    }

    fn input() -> Value {
        json!({ "paperId": "pa", "annotationKey": "k1", "reportSectionId": "s1" })
    }

    #[test]
    fn save_upserts_on_project_paper_and_key_and_returns_the_pin() {
        let q = sent(save(&call(vec![input()], vec![])));
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(
            q.on_conflict.as_deref(),
            Some("project_id,paper_id,annotation_key")
        );
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["report_section_id"], "s1");
        let v = done(save(&call(vec![input()], vec![row()])));
        assert_eq!(v["annotationKey"], "k1");
        assert_eq!(v["reportSectionId"], "s1");
        assert_eq!(v["createdAt"], "2026-11-01T10:00:00Z");
    }

    #[test]
    fn save_needs_a_user_and_a_project() {
        let mut c = call(vec![input()], vec![]);
        c.ctx.user_id = None;
        assert!(matches!(save(&c), RepoStep::Fail { .. }));
        let mut c = call(vec![input()], vec![]);
        c.ctx.project_id = None;
        assert!(matches!(save(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn remove_deletes_by_project_paper_and_key() {
        let q = sent(remove(&call(vec![json!("pa"), json!("k1")], vec![])));
        assert_eq!(q.action, RepoAction::Delete);
        let cols: Vec<_> = q.filters.iter().map(|f| f.column.as_str()).collect();
        assert_eq!(cols, ["project_id", "paper_id", "annotation_key"]);
        assert_eq!(
            done(remove(&call(
                vec![json!("pa"), json!("k1")],
                vec![Value::Null]
            ))),
            Value::Null
        );
    }

    #[test]
    fn list_for_paper_filters_and_lists_oldest_first() {
        let q = sent(step("listForPaper", &call(vec![json!("pa")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.filters[1].column, "paper_id");
        assert_eq!(q.order[0].column, "created_at");
        assert!(q.order[0].ascending);
        let v = done(
            step(
                "listForPaper",
                &call(vec![json!("pa")], vec![json!([row()])]),
            )
            .unwrap(),
        );
        assert_eq!(v[0]["paperId"], "pa");
    }

    #[test]
    fn list_for_section_filters_by_section() {
        let q = sent(step("listForSection", &call(vec![json!("s1")], vec![])).unwrap());
        assert_eq!(q.filters[1].column, "report_section_id");
        assert_eq!(q.filters[1].value, json!("s1"));
    }

    #[test]
    fn list_for_project_and_empty_filters_add_no_paper_filter() {
        let q = sent(step("listForProject", &call(vec![], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
        let q = sent(step("listForPaper", &call(vec![json!("")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn reads_without_a_project_are_empty() {
        let mut c = call(vec![json!("pa")], vec![]);
        c.ctx.project_id = None;
        assert_eq!(done(step("listForPaper", &c).unwrap()), json!([]));
        assert_eq!(done(step("listForProject", &c).unwrap()), json!([]));
        assert!(matches!(remove(&c), RepoStep::Fail { .. }));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
