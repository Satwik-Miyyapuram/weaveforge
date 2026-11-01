//! `POST /api/admin/create-user`: a member creates a lower-rank member account under themselves.
//! Ported from apps/web/src/app/api/admin/create-user/route.ts.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use axum::response::Response;
use serde_json::{Map, Value, json};
use wf_core::member::{NewMember, can_create_role, validate_new_member};

use crate::auth::bearer_token;
use crate::gotrue::{self, Member};
use crate::postgrest::UserDb;
use crate::routes::AppState;
use crate::safe_error::format_error_for_response;
use crate::sdk::{error_response, json_response};

/// `POST /api/admin/create-user`: create the account, its `profiles` row, and answer with the member.
pub async fn create_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let Some(token) = bearer_token(authorization) else {
        return error_response(401, "Not authenticated.");
    };
    let me = match gotrue::resolve_member(&state, token).await {
        Ok(Some(me)) => me,
        Ok(None) => return error_response(403, "Invalid session or missing member profile."),
        Err(err) => {
            return error_response(503, &format_error_for_response(&err, "admin-create-user"));
        }
    };
    let input = match parse_input(&body) {
        Ok(input) => input,
        Err(response) => return response,
    };
    if !can_create_role(&me.role, &input.role) {
        return error_response(
            403,
            &format!("A {} cannot create a {} account.", me.role, input.role),
        );
    }
    match provision(&state, &me.id, &input).await {
        Ok(member) => json_response(201, &json!({ "member": member })),
        Err(message) => provision_failure(&message),
    }
}

/// The body as a validated new member; a non-object body reads as `{}`.
fn parse_input(body: &[u8]) -> Result<NewMember, Response> {
    let parsed = serde_json::from_slice::<Value>(body)
        .map_err(|err| error_response(400, &format!("Invalid JSON body: {err}")))?;
    let object = match parsed {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    let email = required_text(&object, "email")?;
    let password = required_text(&object, "password")?;
    let full_name = optional_text(&object, "fullName")?;
    let supervisor_id = optional_text(&object, "supervisorId")?;
    let role = role_text(&object);
    validate_new_member(
        &email,
        &password,
        full_name.as_deref(),
        &role,
        supervisor_id.as_deref(),
    )
    .map_err(|message| error_response(400, &message))
}

/// A string field; missing or null reads as `""`, any other type is refused.
fn required_text(object: &Map<String, Value>, key: &str) -> Result<String, Response> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(text)) => Ok(text.clone()),
        Some(_) => Err(error_response(400, "Invalid input.")),
    }
}

/// An optional string field; missing or null is `None`, any other type is refused.
fn optional_text(object: &Map<String, Value>, key: &str) -> Result<Option<String>, Response> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(error_response(400, "Invalid input.")),
    }
}

/// The `role` field as the web route reads it: missing is "undefined", null is "null".
fn role_text(object: &Map<String, Value>) -> String {
    match object.get("role") {
        None => "undefined".to_owned(),
        Some(Value::String(role)) => role.clone(),
        Some(Value::Null) => "null".to_owned(),
        Some(other) => other.to_string(),
    }
}

/// Creates the GoTrue user, then its `profiles` row with `supervisor_id` as supervisor.
/// A failed row removes the new user again. The saved member as JSON, or the message to report.
async fn provision(
    state: &AppState,
    supervisor_id: &str,
    input: &NewMember,
) -> Result<Value, String> {
    let id = gotrue::admin_create_user(
        state,
        &input.email,
        &input.password,
        input.full_name.as_deref(),
    )
    .await?;
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let row = json!({
        "user_id": id,
        "email": input.email,
        "full_name": input.full_name,
        "role": input.role,
        "supervisor_id": supervisor_id,
    });
    if let Err(err) = db.upsert("profiles", &row, &[]).await {
        let _ = gotrue::admin_delete_user(state, &id).await;
        return Err(err.message);
    }
    let member = Member {
        id,
        email: Some(input.email.clone()),
        full_name: input.full_name.clone(),
        role: input.role.clone(),
        supervisor_id: Some(supervisor_id.to_owned()),
    };
    Ok(member.to_json())
}

/// The reply for a failed provision: 409 when the email is taken, else 502 with the detail logged.
fn provision_failure(message: &str) -> Response {
    let lower = message.to_lowercase();
    if lower.contains("already registered")
        || lower.contains("already been registered")
        || lower.contains("already exists")
    {
        return error_response(409, "An account with that email address already exists.");
    }
    eprintln!("[admin-create-user] provisioning failed: {message}");
    error_response(502, "Could not create the account.")
}
