//! The SDK's account routes: who the token belongs to, projects and experiments.
//! Ported from apps/web/src/app/api/sdk/{whoami,projects,experiments}/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

use crate::auth::{Caller, require_caller};
use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;
use crate::safe_error::format_error_for_response;

/// Columns the server owns; a request that names them is mistaken or probing.
const SERVER_OWNED_COLUMNS: [&str; 5] = [
    "user_id",
    "created_at",
    "row_version",
    "server_seq",
    "deleted_at",
];

/// `GET /api/sdk/whoami`: the caller's id, with profile names when they can be read.
pub async fn whoami(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let db = user_db(&state, &caller);
    let query = [
        ("select", "email,full_name".to_string()),
        ("user_id", eq(&caller.user_id)),
    ];
    let profile = match db.select("profiles", &query).await {
        Ok(rows) => first_row(rows),
        Err(err) => {
            eprintln!("[sdk-whoami] profile read failed: {}", err.message);
            Value::Null
        }
    };
    json_response(
        200,
        &json!({
            "userId": caller.user_id,
            "email": field(&profile, "email"),
            "fullName": field(&profile, "full_name"),
        }),
    )
}

/// `GET /api/sdk/projects?name=`: the id of the project with that name.
pub async fn projects(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(name) = query_param(&uri, "name") else {
        return error_response(400, "Missing project name.");
    };
    let db = user_db(&state, &caller);
    let query = [
        ("select", "id,name".to_string()),
        ("name", eq(&name)),
        ("limit", "1".to_string()),
    ];
    match db.select("projects", &query).await {
        Ok(rows) => json_response(200, &json!({"projectId": field(&first_row(rows), "id")})),
        Err(err) => db_failure(&err, "sdk-projects"),
    }
}

/// `GET /api/sdk/experiments?id=`: the experiment with that id, or null.
pub async fn experiments_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = query_param(&uri, "id") else {
        return error_response(400, "Missing experiment id.");
    };
    match read_experiment(&user_db(&state, &caller), &id).await {
        Ok(experiment) => json_response(200, &json!({"experiment": experiment})),
        Err(err) => db_failure(&err, "sdk-experiments"),
    }
}

/// `POST /api/sdk/experiments`: create or update an experiment from a JSON object.
pub async fn experiments_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match parse_body(&body) {
        Some(Value::Object(fields)) => fields,
        // An array counts as an object with no keys, as in the Next route.
        Some(_) => Map::new(),
        None => return error_response(400, "Invalid JSON body."),
    };
    let id = text_field(&fields, "id").trim().to_owned();
    if id.is_empty() {
        return error_response(400, "Experiment must include id.");
    }
    let db = user_db(&state, &caller);
    let existing = match read_experiment(&db, &id).await {
        Ok(existing) => existing,
        Err(err) => return db_failure(&err, "sdk-experiments"),
    };
    let mut name = text_field(&fields, "name").trim().to_owned();
    if name.is_empty() {
        name = stored_name(&existing);
    }
    if name.is_empty() {
        return error_response(400, "Experiment must include id and name.");
    }
    let row = write_row(fields, &id, &name, &caller.user_id);
    let query = [("select", "*".to_string())];
    match db.upsert("experiments", &Value::Object(row), &query).await {
        Ok(rows) => json_response(200, &json!({"experiment": first_row(rows)})),
        Err(err) => db_failure(&err, "sdk-experiments"),
    }
}

/// `DELETE /api/sdk/experiments?id=`: delete the caller's experiment with that id.
pub async fn experiments_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let Some(id) = query_param(&uri, "id") else {
        return error_response(400, "Missing experiment id.");
    };
    let db = user_db(&state, &caller);
    match db.delete_counted("experiments", &[("id", eq(&id))]).await {
        Ok(0) => error_response(404, "Experiment not found."),
        Ok(_) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, "sdk-experiments"),
    }
}

/// Who the request acts for; a refusal comes back as the response to send.
pub(crate) async fn caller(state: &AppState, headers: &HeaderMap) -> Result<Caller, Response> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    require_caller(&state.client, &state.config, authorization)
        .await
        .map_err(|err| error_response(err.status, &err.message))
}

/// A database handle that runs as the caller, with the caller's own token.
pub(crate) fn user_db<'a>(state: &'a AppState, caller: &'a Caller) -> UserDb<'a> {
    UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.anon_key,
        &caller.access_token,
    )
}

/// A JSON reply with the given status.
pub(crate) fn json_response(status: u16, value: &Value) -> Response {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (
        status,
        [(CONTENT_TYPE, "application/json")],
        value.to_string(),
    )
        .into_response()
}

/// A JSON reply `{"error": message}` with the given status.
pub(crate) fn error_response(status: u16, message: &str) -> Response {
    json_response(status, &json!({ "error": message }))
}

/// A 500 reply for a failed database call, worded safely for the caller.
pub(crate) fn db_failure(err: &DbError, context: &str) -> Response {
    error_response(500, &format_error_for_response(err, context))
}

/// The first value of query parameter `name`, trimmed; `None` when missing or blank.
pub(crate) fn query_param(uri: &Uri, name: &str) -> Option<String> {
    let query = uri.query()?;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// The JSON body when it is an object or an array; `None` for anything else.
pub(crate) fn parse_body(body: &[u8]) -> Option<Value> {
    serde_json::from_slice::<Value>(body)
        .ok()
        .filter(|value| value.is_object() || value.is_array())
}

/// The first row of a read, or null when there is none.
fn first_row(rows: Vec<Value>) -> Value {
    rows.into_iter().next().unwrap_or(Value::Null)
}

/// Field `key` of a row; a missing or null field reads as null.
fn field(row: &Value, key: &str) -> Value {
    row.get(key).cloned().unwrap_or(Value::Null)
}

/// A string field, or "" when it is missing or not a string.
fn text_field<'a>(fields: &'a Map<String, Value>, key: &str) -> &'a str {
    fields.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The experiment with this id, read as the caller; null when there is none.
async fn read_experiment(db: &UserDb<'_>, id: &str) -> Result<Value, DbError> {
    let query = [
        ("select", "*".to_string()),
        ("id", eq(id)),
        ("limit", "1".to_string()),
    ];
    db.select("experiments", &query).await.map(first_row)
}

/// The name a stored row already has, for the upsert to fall back to; "" when it has none.
fn stored_name(existing: &Value) -> String {
    match existing.get("name") {
        Some(Value::String(name)) => name.clone(),
        Some(Value::Number(number)) if number.as_f64() != Some(0.0) => number.to_string(),
        Some(Value::Bool(true)) => "true".to_owned(),
        _ => String::new(),
    }
}

/// The upsert row: the body minus server-owned columns, with id, name and owner set.
fn write_row(
    mut fields: Map<String, Value>,
    id: &str,
    name: &str,
    user_id: &str,
) -> Map<String, Value> {
    for column in SERVER_OWNED_COLUMNS {
        let _old = fields.remove(column);
    }
    let _old = fields.insert("id".to_owned(), json!(id));
    let _old = fields.insert("name".to_owned(), json!(name));
    let _old = fields.insert("user_id".to_owned(), json!(user_id));
    fields
}
