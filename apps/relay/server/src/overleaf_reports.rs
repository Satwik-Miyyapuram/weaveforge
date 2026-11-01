//! The Overleaf report routes: `/api/overleaf/reports`, linking a project to an Overleaf document.
//! Ported from apps/web/src/app/api/overleaf/reports/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use serde_json::{Map, Value, json};
use wf_core::overleaf::{
    DEFAULT_ENTRY_FILE, entry_file_error, external_url, is_valid_project_id,
    sanitize_section_targets,
};

use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;
use crate::sdk::{
    caller, db_failure, error_response, json_response, no_store, query_param, user_db,
};

const TABLE: &str = "overleaf_linked_reports";
const ROW_FIELDS: &str = "id,project_id,connection_id,title,overleaf_project_id,entry_file,external_url,enabled,last_fetched_at,last_error,section_targets,created_at,updated_at";
const CONTEXT: &str = "overleaf-reports";
const NOT_OBJECT: &str = "Request body must be a JSON object.";
const REQUIRED: &str = "Project, connection, title, and Overleaf project id are required.";
const NOT_FOUND: &str = "Report not found.";
const PATCH_STRING_FIELDS: [&str; 4] = ["id", "title", "overleafProjectId", "entryFile"];

/// A validated create request.
struct NewReport {
    project_id: String,
    connection_id: String,
    title: String,
    overleaf_project_id: String,
    entry_file: String,
}

/// `GET /api/overleaf/reports?projectId=`: the caller's reports, newest first.
pub async fn reports_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(project_id) = query_param(&uri, "projectId") {
        query.push(("project_id", eq(&project_id)));
    }
    query.push(("select", ROW_FIELDS.to_string()));
    query.push(("order", "updated_at.desc".to_string()));
    let db = user_db(&state, &caller);
    match db.select(TABLE, &query).await {
        Ok(rows) => no_store(json_response(200, &json!({"reports": rows}))),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// `POST /api/overleaf/reports`: link one of the caller's projects to an Overleaf project.
pub async fn reports_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match parse_object(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let report = match new_report(&fields) {
        Ok(report) => report,
        Err(response) => return response,
    };
    let db = user_db(&state, &caller);
    match owns_both(&db, &caller.user_id, &report).await {
        Ok(true) => {}
        Ok(false) => return error_response(404, "Project or Overleaf connection not found."),
        Err(err) => return db_failure(&err, CONTEXT),
    }
    let query = [("select", ROW_FIELDS.to_string())];
    match db
        .insert_returning(TABLE, &insert_row(&caller.user_id, &report), &query)
        .await
    {
        Ok(rows) => json_response(201, &json!({"report": first_row(rows)})),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// `PATCH /api/overleaf/reports`: change the caller's report named by `id`.
pub async fn reports_patch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match parse_object(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    if let Err(response) = check_strings(&fields, &PATCH_STRING_FIELDS) {
        return response;
    }
    let id = text(&fields, "id");
    if id.is_empty() {
        return error_response(400, "Report id required.");
    }
    let mut patch = match patch_from(&fields) {
        Ok(patch) => patch,
        Err(response) => return response,
    };
    if patch.is_empty() {
        return error_response(400, "Nothing to update.");
    }
    if patch.contains_key("overleaf_project_id") || patch.contains_key("entry_file") {
        let _old = patch.insert("last_error".to_owned(), Value::Null);
    }
    let query = [
        ("id", eq(&id)),
        ("user_id", eq(&caller.user_id)),
        ("select", ROW_FIELDS.to_string()),
    ];
    let db = user_db(&state, &caller);
    match db
        .update_returning(TABLE, &query, &Value::Object(patch))
        .await
    {
        Ok(rows) if rows.is_empty() => error_response(404, NOT_FOUND),
        Ok(rows) => json_response(200, &json!({"report": first_row(rows)})),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// `DELETE /api/overleaf/reports?id=`: remove the caller's report.
pub async fn reports_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = query_param(&uri, "id") else {
        return error_response(400, "Report id required.");
    };
    let query = [("id", eq(&id)), ("user_id", eq(&caller.user_id))];
    let db = user_db(&state, &caller);
    match db.delete_counted(TABLE, &query).await {
        Ok(0) => error_response(404, NOT_FOUND),
        Ok(_) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, CONTEXT),
    }
}

/// The body as a JSON object, or the 400 reply for invalid JSON or any other shape.
fn parse_object(body: &[u8]) -> Result<Map<String, Value>, Response> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(fields)) => Ok(fields),
        Ok(_) => Err(error_response(400, NOT_OBJECT)),
        Err(err) => Err(error_response(400, &format!("Invalid JSON body: {err}"))),
    }
}

/// The 400 reply for the first of `names` that is present but not a string (null counts).
fn check_strings(fields: &Map<String, Value>, names: &[&str]) -> Result<(), Response> {
    for name in names {
        if fields.get(*name).is_some_and(|value| !value.is_string()) {
            return Err(error_response(400, &format!("{name} must be a string.")));
        }
    }
    Ok(())
}

/// The trimmed string at `key`; empty when missing or not a string.
fn text(fields: &Map<String, Value>, key: &str) -> String {
    fields
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned()
}

/// The entry file to use: `main.tex` when the trimmed input is empty.
fn entry_or_default(raw: String) -> String {
    if raw.is_empty() {
        DEFAULT_ENTRY_FILE.to_owned()
    } else {
        raw
    }
}

/// The 400 reply unless `id` is a valid Overleaf project id.
fn check_overleaf_project_id(id: &str) -> Result<(), Response> {
    if is_valid_project_id(id) {
        Ok(())
    } else {
        Err(error_response(400, "Overleaf project id is invalid."))
    }
}

/// The 400 reply unless `path` is a valid entry file.
fn check_entry_file(path: &str) -> Result<(), Response> {
    match entry_file_error(path) {
        Some(message) => Err(error_response(400, message)),
        None => Ok(()),
    }
}

/// The create request, validated; the first failing rule becomes the 400 reply.
fn new_report(fields: &Map<String, Value>) -> Result<NewReport, Response> {
    check_strings(
        fields,
        &[
            "projectId",
            "connectionId",
            "title",
            "overleafProjectId",
            "entryFile",
        ],
    )?;
    let report = NewReport {
        project_id: text(fields, "projectId"),
        connection_id: text(fields, "connectionId"),
        title: text(fields, "title"),
        overleaf_project_id: text(fields, "overleafProjectId"),
        entry_file: entry_or_default(text(fields, "entryFile")),
    };
    let missing = [
        &report.project_id,
        &report.connection_id,
        &report.title,
        &report.overleaf_project_id,
    ]
    .iter()
    .any(|value| value.is_empty());
    if missing {
        return Err(error_response(400, REQUIRED));
    }
    check_overleaf_project_id(&report.overleaf_project_id)?;
    check_entry_file(&report.entry_file)?;
    Ok(report)
}

/// The column patch for a PATCH body; the first failing rule becomes the 400 reply.
fn patch_from(fields: &Map<String, Value>) -> Result<Map<String, Value>, Response> {
    let mut patch = Map::new();
    if let Some(raw) = fields.get("sectionTargets") {
        let targets = sanitize_section_targets(raw)
            .ok_or_else(|| error_response(400, "Section targets are invalid."))?;
        let _old = patch.insert("section_targets".to_owned(), Value::Object(targets));
    }
    if fields.contains_key("title") {
        apply_title(&mut patch, &text(fields, "title"))?;
    }
    if fields.contains_key("overleafProjectId") {
        apply_overleaf_project(&mut patch, &text(fields, "overleafProjectId"))?;
    }
    if fields.contains_key("entryFile") {
        apply_entry_file(&mut patch, &entry_or_default(text(fields, "entryFile")))?;
    }
    Ok(patch)
}

/// Sets `title` in the patch unless it is blank.
fn apply_title(patch: &mut Map<String, Value>, title: &str) -> Result<(), Response> {
    if title.is_empty() {
        return Err(error_response(400, "Title cannot be empty."));
    }
    let _old = patch.insert("title".to_owned(), json!(title));
    Ok(())
}

/// Sets the Overleaf project id and its link in the patch.
fn apply_overleaf_project(patch: &mut Map<String, Value>, id: &str) -> Result<(), Response> {
    if id.is_empty() {
        return Err(error_response(400, "Overleaf project id cannot be empty."));
    }
    check_overleaf_project_id(id)?;
    let _old = patch.insert("overleaf_project_id".to_owned(), json!(id));
    let _old = patch.insert("external_url".to_owned(), json!(external_url(id)));
    Ok(())
}

/// Sets `entry_file` in the patch once it is a valid path.
fn apply_entry_file(patch: &mut Map<String, Value>, entry: &str) -> Result<(), Response> {
    check_entry_file(entry)?;
    let _old = patch.insert("entry_file".to_owned(), json!(entry));
    Ok(())
}

/// Whether the caller owns both the project and the connection of `report`.
async fn owns_both(db: &UserDb<'_>, user_id: &str, report: &NewReport) -> Result<bool, DbError> {
    let project = owns(db, "projects", &report.project_id, user_id).await?;
    let connection = owns(db, "overleaf_connections", &report.connection_id, user_id).await?;
    Ok(project && connection)
}

/// Whether the caller owns a row with `id` in `table`.
async fn owns(db: &UserDb<'_>, table: &str, id: &str, user_id: &str) -> Result<bool, DbError> {
    let query = [
        ("select", "id".to_string()),
        ("id", eq(id)),
        ("user_id", eq(user_id)),
    ];
    Ok(!db.select(table, &query).await?.is_empty())
}

/// The row stored for a validated create request.
fn insert_row(user_id: &str, report: &NewReport) -> Value {
    json!({
        "user_id": user_id,
        "project_id": report.project_id,
        "connection_id": report.connection_id,
        "title": report.title,
        "overleaf_project_id": report.overleaf_project_id,
        "entry_file": report.entry_file,
        "external_url": external_url(&report.overleaf_project_id),
    })
}

/// The first row of a write, or null when there is none.
fn first_row(rows: Vec<Value>) -> Value {
    rows.into_iter().next().unwrap_or(Value::Null)
}
