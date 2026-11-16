//! The `annotation_quotation_types` repository as Rust-planned queries.
//!
//! Ported from `apps/web/src/features/papers/infrastructure/postgrest-annotation-quotation-type-repository.ts`.

use serde::Deserialize;
use serde_json::json;

use crate::papers::annotation_quotation_type::is_quotation_type;
use crate::papers::annotation_quotation_type_row::{
    AnnotationQuotationType, AnnotationQuotationTypeRow, to_domain,
};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep};

const TABLE: &str = "annotation_quotation_types";

/// The columns a [`AnnotationQuotationTypeRow`] is read as, named rather than starred.
pub const ANNOTATION_QUOTATION_TYPE_COLUMNS: &str =
    "id,paper_id,annotation_key,quotation_type,created_at,updated_at";

/// The action named in "Select a project before {action}.".
const ACTION: &str = "managing quotation types";

/// `save`'s input, as the TS sender passes it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInput {
    paper_id: String,
    annotation_key: String,
    quotation_type: String,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "save" => save(call),
        "remove" => remove(call),
        "listForPaper" => list_for_paper(call),
        _ => return None,
    })
}

/// `save(input)`: upserts on `(project_id, paper_id, annotation_key)`; the stored domain value.
fn save(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        let input: SaveInput = match call.parse(0) {
            Ok(input) => input,
            Err(e) => return RepoStep::fail(e),
        };
        if !is_quotation_type(&input.quotation_type) {
            return RepoStep::fail(format!("Invalid quotation type: {}", input.quotation_type));
        }
        let user = match call.user() {
            Ok(u) => u.to_owned(),
            Err(s) => return s,
        };
        let project = match call.project(ACTION) {
            Ok(p) => p.to_owned(),
            Err(s) => return s,
        };
        return RepoStep::send(
            RepoQuery::upsert(
                TABLE,
                json!({
                    "user_id": user,
                    "project_id": project,
                    "paper_id": input.paper_id,
                    "annotation_key": input.annotation_key,
                    "quotation_type": input.quotation_type,
                    "updated_at": call.now(),
                }),
            )
            .on_conflict("project_id,paper_id,annotation_key", false)
            .returning(ANNOTATION_QUOTATION_TYPE_COLUMNS)
            .single(),
        );
    }
    match call.reply::<AnnotationQuotationTypeRow>(0) {
        Some(Ok(row)) => match to_domain(row) {
            Ok(mapped) => RepoStep::done(&mapped),
            Err(message) => RepoStep::fail(message),
        },
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `remove(paperId, annotationKey)`.
fn remove(call: &RepoCall) -> RepoStep {
    let project = match call.project(ACTION) {
        Ok(p) => p.to_owned(),
        Err(s) => return s,
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::delete(TABLE)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .eq("annotation_key", call.text(1)),
        );
    }
    RepoStep::unit()
}

/// `listForPaper(paperId)`: oldest first; empty when no project is selected.
fn list_for_paper(call: &RepoCall) -> RepoStep {
    let Some(project) = call.ctx.project_id.as_deref().filter(|id| !id.is_empty()) else {
        return RepoStep::done(&Vec::<AnnotationQuotationType>::new());
    };
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, ANNOTATION_QUOTATION_TYPE_COLUMNS)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .order("created_at", true),
        );
    }
    match call.reply::<Vec<AnnotationQuotationTypeRow>>(0) {
        Some(Ok(rows)) => match rows
            .into_iter()
            .map(to_domain)
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(mapped) => RepoStep::done(&mapped),
            Err(message) => RepoStep::fail(message),
        },
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo_query::{RepoAction, RepoCtx};
    use serde_json::Value;
    use serde_json::json;

    fn call(args: Vec<Value>, replies: Vec<Value>, project: Option<&str>) -> RepoCall {
        RepoCall {
            args,
            replies,
            ctx: RepoCtx {
                project_id: project.map(Into::into),
                user_id: Some("u1".into()),
                now: Some("2026-02-02T00:00:00.000Z".into()),
                id_seed: None,
            },
        }
    }

    fn save_input(quotation_type: &str) -> Value {
        json!({"paperId": "p1", "annotationKey": "k1", "quotationType": quotation_type})
    }

    fn only(step: RepoStep) -> RepoQuery {
        match step {
            RepoStep::Send { mut queries } if queries.len() == 1 => queries.remove(0),
            other => panic!("expected one query, got {other:?}"),
        }
    }

    fn row(quotation_type: &str) -> Value {
        json!({
            "id": "q1", "paper_id": "p1", "annotation_key": "k1",
            "quotation_type": quotation_type,
            "created_at": "2026-01-01T00:00:00.000Z", "updated_at": "2026-01-01T00:00:00.000Z"
        })
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![], Some("pr1"))).is_none());
    }

    #[test]
    fn save_upserts_on_project_paper_key_with_now() {
        let c = call(vec![save_input("direct")], vec![], Some("pr1"));
        let q = only(step("save", &c).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(
            q.on_conflict.as_deref(),
            Some("project_id,paper_id,annotation_key")
        );
        assert_eq!(
            q.columns.as_deref(),
            Some(ANNOTATION_QUOTATION_TYPE_COLUMNS)
        );
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "pr1");
        assert_eq!(body["paper_id"], "p1");
        assert_eq!(body["annotation_key"], "k1");
        assert_eq!(body["quotation_type"], "direct");
        assert_eq!(body["updated_at"], "2026-02-02T00:00:00.000Z");
    }

    #[test]
    fn save_maps_the_upserted_row() {
        let c = call(
            vec![save_input("summary")],
            vec![json!(row("summary"))],
            Some("pr1"),
        );
        let s = step("save", &c).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value["quotationType"], "summary");
        assert_eq!(value["id"], "q1");
    }

    #[test]
    fn save_refuses_unknown_quotation_type_before_querying() {
        let c = call(vec![save_input("quote")], vec![], Some("pr1"));
        assert_eq!(
            step("save", &c).unwrap(),
            RepoStep::fail("Invalid quotation type: quote")
        );
    }

    #[test]
    fn save_fails_without_user_or_project() {
        let mut c = call(vec![save_input("direct")], vec![], Some("pr1"));
        c.ctx.user_id = None;
        assert_eq!(step("save", &c).unwrap(), RepoStep::fail("Not signed in."));
        let c = call(vec![save_input("direct")], vec![], None);
        assert_eq!(
            step("save", &c).unwrap(),
            RepoStep::fail("Select a project before managing quotation types.")
        );
    }

    #[test]
    fn save_fails_on_unknown_stored_type_in_reply() {
        let c = call(
            vec![save_input("direct")],
            vec![json!(row("quote"))],
            Some("pr1"),
        );
        assert_eq!(
            step("save", &c).unwrap(),
            RepoStep::fail("Invalid quotation type in store: quote")
        );
    }

    #[test]
    fn remove_deletes_by_project_paper_and_key() {
        let c = call(vec![json!("p1"), json!("k1")], vec![], Some("pr1"));
        let q = only(step("remove", &c).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[0].value, json!("pr1"));
        assert_eq!(q.filters[1].value, json!("p1"));
        assert_eq!(q.filters[2].value, json!("k1"));
    }

    #[test]
    fn remove_resolves_to_unit_after_reply() {
        let c = call(
            vec![json!("p1"), json!("k1")],
            vec![Value::Null],
            Some("pr1"),
        );
        assert_eq!(step("remove", &c).unwrap(), RepoStep::unit());
    }

    #[test]
    fn remove_fails_without_project() {
        let c = call(vec![json!("p1"), json!("k1")], vec![], None);
        assert_eq!(
            step("remove", &c).unwrap(),
            RepoStep::fail("Select a project before managing quotation types.")
        );
    }

    #[test]
    fn list_for_paper_selects_oldest_first() {
        let c = call(vec![json!("p1")], vec![], Some("pr1"));
        let q = only(step("listForPaper", &c).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(
            q.columns.as_deref(),
            Some(ANNOTATION_QUOTATION_TYPE_COLUMNS)
        );
        assert_eq!(q.filters[0].column, "project_id");
        assert_eq!(q.filters[1].value, json!("p1"));
        assert!(q.order[0].ascending);
    }

    #[test]
    fn list_for_paper_maps_rows_to_domain() {
        let c = call(
            vec![json!("p1")],
            vec![json!([row("summary")])],
            Some("pr1"),
        );
        let s = step("listForPaper", &c).unwrap();
        let RepoStep::Done { value } = s else {
            panic!("{s:?}")
        };
        assert_eq!(value[0]["id"], "q1");
        assert_eq!(value[0]["quotationType"], "summary");
        assert_eq!(value[0]["annotationKey"], "k1");
    }

    #[test]
    fn list_for_paper_is_empty_without_project() {
        let c = call(vec![json!("p1")], vec![], None);
        assert_eq!(
            step("listForPaper", &c).unwrap(),
            RepoStep::done(&Vec::<AnnotationQuotationType>::new())
        );
    }

    #[test]
    fn list_for_paper_fails_on_unknown_stored_type() {
        let c = call(vec![json!("p1")], vec![json!([row("quote")])], Some("pr1"));
        assert_eq!(
            step("listForPaper", &c).unwrap(),
            RepoStep::fail("Invalid quotation type in store: quote")
        );
    }

    #[test]
    fn list_for_paper_fails_on_bad_row() {
        let c = call(vec![json!("p1")], vec![json!([{"id": 1}])], Some("pr1"));
        assert!(matches!(
            step("listForPaper", &c).unwrap(),
            RepoStep::Fail { .. }
        ));
    }
}
