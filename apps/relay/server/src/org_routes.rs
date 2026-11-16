//! The lab API routes: `/api/org/*`, ported from apps/web/src/app/api/org/*/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, Uri};
use axum::response::Response;
use serde_json::{Map, Value, json};

use crate::auth::{Caller, require_session};
use crate::org::{OrgError, OrgService};
use crate::postgrest::UserDb;
use crate::routes::AppState;
use crate::sdk::{db_failure, error_response, json_response, query_param};

/// `GET /api/org/codes?code=`: the lab and role a join code leads to.
pub async fn codes_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    if let Err(response) = session(&state, &headers).await {
        return response;
    }
    let Some(code) = query_param(&uri, "code") else {
        return error_response(400, "code required");
    };
    match OrgService::new(&state).preview_code(&code).await {
        Ok(Some(preview)) => json_response(200, &preview),
        Ok(None) => error_response(404, "Invalid code."),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/codes`: make a new invite code for a role, revoking the old one.
pub async fn codes_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match read_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let (Some(org_id), Some(target_role)) = (
        str_field(&fields, "orgId"),
        str_field(&fields, "targetRole"),
    ) else {
        return error_response(400, "orgId and targetRole required.");
    };
    match OrgService::new(&state)
        .regenerate_code(&caller.user_id, org_id, target_role)
        .await
    {
        Ok(code) => json_response(200, &code),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/create`: create a lab owned by the caller.
pub async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match read_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let name = str_field(&fields, "name").unwrap_or("");
    match OrgService::new(&state)
        .create_organization(&caller.user_id, name)
        .await
    {
        Ok(result) => json_response(201, &result),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/join`: join a lab with its invite code.
pub async fn join(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match read_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let code = str_field(&fields, "code").unwrap_or("");
    let phd_supervisor = str_field(&fields, "phdSupervisorId");
    let professor_supervisor = str_field(&fields, "professorSupervisorId");
    match OrgService::new(&state)
        .join_organization(&caller.user_id, code, phd_supervisor, professor_supervisor)
        .await
    {
        Ok(result) => json_response(200, &result),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/leave`: leave a lab the caller is a member of.
pub async fn leave(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match read_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let Some(org_id) = str_field(&fields, "orgId") else {
        return error_response(400, "orgId required.");
    };
    match OrgService::new(&state)
        .leave_organization(&caller.user_id, org_id)
        .await
    {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/switch`: make a lab the caller's active one.
pub async fn switch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match read_body(&body) {
        Ok(fields) => fields,
        Err(response) => return response,
    };
    let Some(org_id) = str_field(&fields, "orgId") else {
        return error_response(400, "orgId required");
    };
    match OrgService::new(&state)
        .switch_active_organization(&caller.user_id, org_id)
        .await
    {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(err) => org_error(&err),
    }
}

/// `GET /api/org/memberships`: the labs the caller is in.
pub async fn memberships(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match OrgService::new(&state)
        .list_memberships(&caller.user_id)
        .await
    {
        Ok(list) => json_response(200, &json!({"memberships": list})),
        Err(err) => org_error(&err),
    }
}

/// `GET /api/org/mine`: the labs the caller owns.
pub async fn mine(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match OrgService::new(&state).list_owned(&caller.user_id).await {
        Ok(list) => json_response(200, &json!({"organizations": list})),
        Err(err) => org_error(&err),
    }
}

/// `POST /api/org/standalone`: finish onboarding as the caller, not the admin.
pub async fn standalone(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let caller = match session(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.anon_key,
        &caller.access_token,
    );
    let mut result = db.rpc("complete_org_setup", &json!({})).await;
    if result.is_err() {
        let _provisioned = db.rpc("ensure_user_provisioned", &json!({})).await;
        result = db.rpc("complete_org_setup", &json!({})).await;
    }
    match result {
        Ok(_) => json_response(200, &json!({"ok": true})),
        Err(err) => db_failure(&err, "org-standalone"),
    }
}

/// The signed-in session behind the request; a refusal comes back as the response to send.
async fn session(state: &AppState, headers: &HeaderMap) -> Result<Caller, Response> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    require_session(&state.client, &state.config, authorization)
        .await
        .map_err(|err| error_response(err.status, &err.message))
}

/// A service error as its status and message.
fn org_error(err: &OrgError) -> Response {
    error_response(err.status(), &err.message())
}

/// The request body as a JSON object; a 400 when it is not JSON or not an object.
fn read_body(body: &[u8]) -> Result<Map<String, Value>, Response> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Object(fields)) => Ok(fields),
        Ok(_) => Err(error_response(400, "Body must be a JSON object.")),
        Err(err) => Err(error_response(400, &format!("Invalid JSON body: {err}"))),
    }
}

/// A string field that is present and non-empty; None otherwise.
fn str_field<'a>(fields: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    fields
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
