//! The `paper_field_defs` and `paper_field_values` repositories as Rust-planned queries.
//!
//! Ported from `PostgrestPaperFieldRepository` in
//! `apps/web/src/features/papers/infrastructure/parts-1.ts`. One module for both tables, as
//! the TS class owns both. Rows map with [`paper_field_row`]. `PaperImageStore` (blob storage)
//! stays in TS.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::papers::paper_field::PaperFieldValueData;
use crate::papers::paper_field_row::{
    PaperFieldDef, PaperFieldDefRow, PaperFieldValueRow, to_def_domain, to_value_domain,
};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_rows};

const DEFS: &str = "paper_field_defs";
const VALUES: &str = "paper_field_values";
const DEF_COLUMNS: &str = "id, name, kind, options, sort_order";
const VALUE_COLUMNS: &str = "id, paper_id, field_id, value";
const ACTION: &str = "managing paper fields";

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "listDefs" => list_defs(call),
        "saveDef" => save_def(call),
        "deleteDef" => delete_def(call),
        "listValuesForPaper" => list_values(call, Some(call.text(0))),
        "listValuesForProject" => list_values(call, None),
        "setValue" => set_value(call),
        "removeValue" => remove_value(call),
        _ => return None,
    })
}

fn to_def(row: &PaperFieldDefRow) -> PaperFieldDef {
    to_def_domain(row.clone())
}

/// The field definitions of the selected project, in display order, then by name; none
/// without a project.
fn list_defs(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return map_rows(call, 0, to_def);
    }
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(project) => RepoStep::send(
            RepoQuery::select(DEFS, DEF_COLUMNS)
                .eq("project_id", project)
                .order("sort_order", true)
                .order("name", true),
        ),
        None => RepoStep::done(&Vec::<Value>::new()),
    }
}

/// `saveDef(def)`: upsert on `id`; the reply is not read.
fn save_def(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let def: PaperFieldDef = match call.parse(0) {
        Ok(def) => def,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            DEFS,
            json!({
                "id": def.id,
                "user_id": user,
                "project_id": project,
                "name": def.name,
                "kind": def.kind,
                "options": def.options,
                "sort_order": def.sort_order,
            }),
        )
        .on_conflict("id", false),
    )
}

/// `deleteDef(id)`.
fn delete_def(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.project(ACTION) {
        Ok(project) => RepoStep::send(
            RepoQuery::delete(DEFS)
                .eq("project_id", project)
                .eq("id", call.text(0)),
        ),
        Err(step) => step,
    }
}

/// Maps the value rows in reply `0`; one stored value that does not read fails the call.
fn values_from_reply(call: &RepoCall) -> RepoStep {
    match call.reply::<Vec<PaperFieldValueRow>>(0) {
        Some(Ok(rows)) => {
            match rows
                .into_iter()
                .map(to_value_domain)
                .collect::<Result<Vec<_>, _>>()
            {
                Ok(values) => RepoStep::done(&values),
                Err(e) => RepoStep::fail(e),
            }
        }
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// The value of one paper for one field in reply `0`, checked as the list is.
fn value_from_reply(call: &RepoCall) -> RepoStep {
    match call.reply::<PaperFieldValueRow>(0) {
        Some(Ok(row)) => match to_value_domain(row) {
            Ok(value) => RepoStep::done(&value),
            Err(e) => RepoStep::fail(e),
        },
        Some(Err(e)) => RepoStep::fail(e),
        None => RepoStep::fail("reply 0 missing"),
    }
}

/// `listValuesForPaper(paperId)` and `listValuesForProject()`: by paper, then field; none
/// without a project. An empty paper id adds no filter, as the TS does.
fn list_values(call: &RepoCall, paper: Option<&str>) -> RepoStep {
    if !call.replies.is_empty() {
        return values_from_reply(call);
    }
    match call.ctx.project_id.as_deref().filter(|p| !p.is_empty()) {
        Some(project) => {
            let mut query = RepoQuery::select(VALUES, VALUE_COLUMNS).eq("project_id", project);
            if let Some(paper) = paper.filter(|p| !p.is_empty()) {
                query = query.eq("paper_id", paper);
            }
            RepoStep::send(query.order("paper_id", true).order("field_id", true))
        }
        None => RepoStep::done(&Vec::<Value>::new()),
    }
}

/// `SetPaperFieldValueInput`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewValue {
    paper_id: String,
    field_id: String,
    value: PaperFieldValueData,
}

/// `setValue(input)`: upsert on (project, paper, field) and return the stored value.
fn set_value(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return value_from_reply(call);
    }
    let user = match call.user() {
        Ok(user) => user,
        Err(step) => return step,
    };
    let project = match call.project(ACTION) {
        Ok(project) => project,
        Err(step) => return step,
    };
    let input: NewValue = match call.parse(0) {
        Ok(input) => input,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(
        RepoQuery::upsert(
            VALUES,
            json!({
                "user_id": user,
                "project_id": project,
                "paper_id": input.paper_id,
                "field_id": input.field_id,
                "value": input.value,
            }),
        )
        .on_conflict("project_id,paper_id,field_id", false)
        .returning(VALUE_COLUMNS)
        .single(),
    )
}

/// `removeValue(paperId, fieldId)`.
fn remove_value(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    match call.project(ACTION) {
        Ok(project) => RepoStep::send(
            RepoQuery::delete(VALUES)
                .eq("project_id", project)
                .eq("paper_id", call.text(0))
                .eq("field_id", call.text(1)),
        ),
        Err(step) => step,
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

    fn def_json() -> Value {
        json!({ "id": "f1", "name": "Venue", "kind": "select",
            "options": ["A", "B"], "sortOrder": 2.0 })
    }

    #[allow(clippy::needless_pass_by_value)]
    fn value_row(value: Value) -> Value {
        json!({ "id": "v1", "paper_id": "pa", "field_id": "f1", "value": value })
    }

    #[test]
    fn list_defs_orders_by_sort_then_name_and_maps_to_domain() {
        let q = sent(step("listDefs", &call(vec![], vec![])).unwrap());
        assert_eq!(q.order[0].column, "sort_order");
        assert_eq!(q.order[1].column, "name");
        let rows = json!([{ "id": "f1", "name": "Venue", "kind": "select",
            "options": ["A", 1, "B"], "sort_order": 2.0 }]);
        let v = done(step("listDefs", &call(vec![], vec![rows])).unwrap());
        assert_eq!(v[0]["kind"], "select");
        assert_eq!(v[0]["options"], json!(["A", "B"]));
        assert_eq!(v[0]["sortOrder"], 2.0);
    }

    #[test]
    fn save_def_upserts_on_id_with_the_user_and_project() {
        let q = sent(step("saveDef", &call(vec![def_json()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(q.on_conflict.as_deref(), Some("id"));
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], "u1");
        assert_eq!(body["project_id"], "p1");
        assert_eq!(body["kind"], "select");
        assert_eq!(body["sort_order"], 2.0);
        assert_eq!(
            done(step("saveDef", &call(vec![def_json()], vec![Value::Null])).unwrap()),
            Value::Null
        );
    }

    #[test]
    fn delete_def_deletes_by_project_and_id() {
        let q = sent(step("deleteDef", &call(vec![json!("f1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        assert_eq!(q.filters[1].column, "id");
        assert_eq!(q.filters[1].value, json!("f1"));
    }

    #[test]
    fn list_values_filters_by_paper_when_given_and_orders_by_paper_then_field() {
        let q = sent(step("listValuesForPaper", &call(vec![json!("pa")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 2);
        assert_eq!(q.order[0].column, "paper_id");
        assert_eq!(q.order[1].column, "field_id");
        let q = sent(step("listValuesForProject", &call(vec![], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
        let q = sent(step("listValuesForPaper", &call(vec![json!("")], vec![])).unwrap());
        assert_eq!(q.filters.len(), 1);
    }

    #[test]
    fn list_values_maps_rows_and_fails_on_a_bad_stored_value() {
        let v = done(
            step(
                "listValuesForProject",
                &call(vec![], vec![json!([value_row(json!("VAE"))])]),
            )
            .unwrap(),
        );
        assert_eq!(v[0]["fieldId"], "f1");
        assert_eq!(v[0]["value"], "VAE");
        let bad = step(
            "listValuesForProject",
            &call(vec![], vec![json!([value_row(json!(true))])]),
        )
        .unwrap();
        assert!(matches!(bad, RepoStep::Fail { .. }));
    }

    #[test]
    fn set_value_upserts_on_project_paper_and_field() {
        let input = json!({ "paperId": "pa", "fieldId": "f1", "value": ["A", "B"] });
        let q = sent(step("setValue", &call(vec![input.clone()], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        assert_eq!(
            q.on_conflict.as_deref(),
            Some("project_id,paper_id,field_id")
        );
        assert_eq!(q.body.unwrap()["value"], json!(["A", "B"]));
        let v = done(step("setValue", &call(vec![input], vec![value_row(json!(3.5))])).unwrap());
        assert_eq!(v["paperId"], "pa");
        assert_eq!(v["value"], 3.5);
    }

    #[test]
    fn remove_value_deletes_by_project_paper_and_field() {
        let q = sent(step("removeValue", &call(vec![json!("pa"), json!("f1")], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Delete);
        let cols: Vec<_> = q.filters.iter().map(|f| f.column.as_str()).collect();
        assert_eq!(cols, ["project_id", "paper_id", "field_id"]);
    }

    #[test]
    fn writes_need_a_project_and_reads_without_one_are_empty() {
        let mut c = call(vec![def_json()], vec![]);
        c.ctx.project_id = None;
        assert!(matches!(
            step("saveDef", &c).unwrap(),
            RepoStep::Fail { .. }
        ));
        assert!(matches!(
            step("deleteDef", &c).unwrap(),
            RepoStep::Fail { .. }
        ));
        assert!(matches!(
            step("removeValue", &c).unwrap(),
            RepoStep::Fail { .. }
        ));
        assert_eq!(done(step("listDefs", &c).unwrap()), json!([]));
        assert_eq!(done(step("listValuesForPaper", &c).unwrap()), json!([]));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
