//! The `projects` repository as Rust-planned queries (TS `PostgrestProjectRepository` and
//! `ProjectZoteroStore` in `backend/providers/postgrest/wire-postgrest-backend.ts`). Row mapping
//! is `project_row`. The keyed JSON columns live in [`super::project_columns`].

use serde::Deserialize;
use serde_json::{Value, json};

use crate::project_row::{ProjectRow, to_project};
use crate::repo_query::{RepoCall, RepoQuery, RepoStep, map_row, map_rows};

const TABLE: &str = "projects";

/// The columns a project is listed with, named rather than starred.
const PROJECT_COLUMNS: &str = "id,name,color,created_at";

/// A project as the app saves it (TS `Project`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInput {
    id: String,
    name: String,
    #[serde(default)]
    color: Option<String>,
    created_at: String,
}

/// The `zotero_collection` column alone.
#[derive(Deserialize)]
struct CollectionRow {
    zotero_collection: Option<String>,
}

/// The next step of `method`, or `None` for an unknown method.
#[must_use]
pub fn step(method: &str, call: &RepoCall) -> Option<RepoStep> {
    Some(match method {
        "getById" => get_by_id(call),
        "list" => list(call),
        "save" => save(call),
        "delete" => delete(call),
        "getCollection" => get_collection(call),
        "setCollection" => set_collection(call),
        _ => return None,
    })
}

/// `getById(id)`: the project, or `null`. Reads every column, as `rowById` does.
fn get_by_id(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, "*")
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<ProjectRow>| {
        row.as_ref().map(to_project)
    })
}

/// `list()`: every project the caller can see, oldest first.
fn list(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::select(TABLE, PROJECT_COLUMNS).order("created_at", true));
    }
    map_rows(call, 0, to_project)
}

/// `save(project)`: upsert, owned by the signed-in user (`null` when signed out, as TS sends).
fn save(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let p: ProjectInput = match call.parse(0) {
        Ok(p) => p,
        Err(e) => return RepoStep::fail(e),
    };
    RepoStep::send(RepoQuery::upsert(
        TABLE,
        json!({
            "id": p.id,
            "user_id": call.ctx.user_id,
            "name": p.name,
            "color": p.color,
            "created_at": p.created_at,
        }),
    ))
}

/// `delete(id)`: removes by id, as `deleteRowById` does.
fn delete(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(RepoQuery::delete(TABLE).eq("id", call.text(0)));
    }
    RepoStep::unit()
}

/// `getCollection(projectId)`: the project's Zotero collection, or `null` when unset or missing.
fn get_collection(call: &RepoCall) -> RepoStep {
    if call.replies.is_empty() {
        return RepoStep::send(
            RepoQuery::select(TABLE, "zotero_collection")
                .eq("id", call.text(0))
                .maybe_single(),
        );
    }
    map_row(call, 0, |row: &Option<CollectionRow>| {
        row.as_ref().and_then(|r| r.zotero_collection.clone())
    })
}

/// `setCollection(projectId, collection)`: an empty or `null` collection clears it.
fn set_collection(call: &RepoCall) -> RepoStep {
    if !call.replies.is_empty() {
        return RepoStep::unit();
    }
    let collection = match call.arg(1) {
        Value::String(s) if !s.is_empty() => Value::from(s.as_str()),
        _ => Value::Null,
    };
    RepoStep::send(
        RepoQuery::update(TABLE, json!({ "zotero_collection": collection })).eq("id", call.text(0)),
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

    #[test]
    fn get_by_id_reads_one_row_and_maps_null_colour_away() {
        let q = sent(step("getById", &call(vec![json!("p1")], vec![])).unwrap());
        assert_eq!(q.table, TABLE);
        assert_eq!(q.single, RepoSingle::Maybe);
        let row =
            json!({"id":"p1","name":"T","color":null,"created_at":"2026-01-01","user_id":"u1"});
        let v = done(step("getById", &call(vec![json!("p1")], vec![row])).unwrap());
        assert_eq!(v, json!({"id":"p1","name":"T","createdAt":"2026-01-01"}));
        let none = done(step("getById", &call(vec![json!("p9")], vec![Value::Null])).unwrap());
        assert_eq!(none, Value::Null);
    }

    #[test]
    fn list_orders_by_created_at_with_named_columns() {
        let q = sent(step("list", &call(vec![], vec![])).unwrap());
        assert_eq!(q.columns.as_deref(), Some(PROJECT_COLUMNS));
        assert_eq!(q.order.len(), 1);
        assert!(q.order[0].ascending);
    }

    #[test]
    fn save_stamps_user_and_nulls_missing_colour() {
        let p = json!({"id":"p1","name":"T","createdAt":"2026-01-01"});
        let q = sent(step("save", &call(vec![p], vec![])).unwrap());
        assert_eq!(q.action, RepoAction::Upsert);
        let body = q.body.unwrap();
        assert_eq!(body["user_id"], json!("u1"));
        assert_eq!(body["color"], Value::Null);
        assert_eq!(body["created_at"], json!("2026-01-01"));
    }

    #[test]
    fn collection_reads_null_and_clears_on_empty() {
        let v = done(
            step(
                "getCollection",
                &call(vec![json!("p1")], vec![json!({"zotero_collection":null})]),
            )
            .unwrap(),
        );
        assert_eq!(v, Value::Null);
        let v = done(
            step(
                "getCollection",
                &call(vec![json!("p1")], vec![json!({"zotero_collection":"C1"})]),
            )
            .unwrap(),
        );
        assert_eq!(v, json!("C1"));
        let q = sent(step("setCollection", &call(vec![json!("p1"), json!("")], vec![])).unwrap());
        assert_eq!(q.body.unwrap(), json!({"zotero_collection": null}));
        let q = sent(
            step(
                "setCollection",
                &call(vec![json!("p1"), json!("C2")], vec![]),
            )
            .unwrap(),
        );
        assert_eq!(q.body.unwrap(), json!({"zotero_collection": "C2"}));
    }

    #[test]
    fn unknown_method_is_none() {
        assert!(step("nope", &call(vec![], vec![])).is_none());
    }
}
