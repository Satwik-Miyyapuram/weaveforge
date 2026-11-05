//! `POST /api/account/delete-user` and `POST /api/account/delete-user/otp`: a member
//! deletes their own account after confirming a one-time code emailed to them.
//! Ported from apps/web/src/app/api/account/delete-user/{_shared.ts,route.ts,otp/route.ts}.
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
use wf_core::member::{mask_email, parse_otp_or_link};

use crate::account_purge::purge_user_blobs;
use crate::auth::bearer_token;
use crate::gotrue::{
    admin_delete_user, resolve_member, send_email_otp, session_user_id, verify_email_otp,
};
use crate::postgrest::UserDb;
use crate::routes::AppState;
use crate::sdk::{error_response, json_response};

/// `POST /api/account/delete-user/otp`: emails the caller a confirmation code.
pub async fn delete_user_otp(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let (_, _, email) = match delete_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match send_email_otp(&state, &email).await {
        Ok(()) => json_response(200, &json!({"ok": true, "emailHint": mask_email(&email)})),
        Err(message) => json_response(500, &json!({"error": message})),
    }
}

/// `POST /api/account/delete-user`: deletes the caller's account once the emailed code checks out.
pub async fn delete_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let (token, user_id, email) = match delete_caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    let fields = match serde_json::from_slice::<Value>(&body) {
        Ok(Value::Object(fields)) => fields,
        Ok(_) => Map::new(),
        Err(err) => return error_response(400, &format!("Invalid JSON body: {err}")),
    };
    if fields.get("confirmation").and_then(Value::as_str) != Some("DELETE_USER") {
        return error_response(400, "Type DELETE_USER to confirm account deletion.");
    }
    let otp = fields
        .get("otp")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if otp.is_empty() {
        return error_response(400, "Enter the confirmation code emailed to you.");
    }
    match confirm_and_delete(&state, &token, &user_id, &email, otp).await {
        Ok(()) => json_response(200, &json!({"ok": true})),
        Err(response) => response,
    }
}

/// The caller's token, user id and email; or the refusal to answer with.
async fn delete_caller(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(String, String, String), Response> {
    let authorization = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let Some(token) = bearer_token(authorization) else {
        return Err(error_response(401, "Not authenticated."));
    };
    let member = match resolve_member(state, token).await {
        Ok(Some(member)) => member,
        Ok(None) => return Err(error_response(401, "Invalid session.")),
        Err(err) => {
            let status = if err.message.starts_with("Forbidden") {
                403
            } else {
                401
            };
            return Err(error_response(status, &err.message));
        }
    };
    let email = member.email.as_deref().unwrap_or("").trim().to_owned();
    if email.is_empty() {
        return Err(error_response(
            400,
            "Your account has no email address; contact an administrator to delete it.",
        ));
    }
    Ok((token.to_owned(), member.id, email))
}

/// Checks the code, then removes the caller's data and auth account; `Err` is the answer to send.
async fn confirm_and_delete(
    state: &AppState,
    token: &str,
    user_id: &str,
    email: &str,
    otp: &str,
) -> Result<(), Response> {
    let Some(input) = parse_otp_or_link(otp) else {
        return Err(failure(
            "Enter the 6-digit code or confirmation link from your email.",
        ));
    };
    let verified = verify_email_otp(state, email, &input)
        .await
        .map_err(|message| failure(&message))?;
    if verified != user_id {
        return Err(error_response(
            403,
            "Confirmation code does not match this account.",
        ));
    }
    if session_user_id(state, token).await.is_none() {
        return Err(failure("Invalid session."));
    }
    purge_user_blobs(state, user_id)
        .await
        .map_err(|message| failure(&message))?;
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let _purged = db
        .rpc("delete_user_account_data", &json!({"p_user_id": user_id}))
        .await
        .map_err(|err| failure(&err.message))?;
    admin_delete_user(state, user_id)
        .await
        .map_err(|message| failure(&message))
}

/// A `{ "error": msg }` answer whose status follows from the message.
fn failure(message: &str) -> Response {
    error_response(failure_status(message), message)
}

/// The HTTP status for a failed step, read from its message.
fn failure_status(message: &str) -> u16 {
    let lower = message.to_lowercase();
    if message == "Invalid session." {
        401
    } else if message.starts_with("Forbidden") {
        403
    } else if ["invalid", "expired", "confirmation code", "6-digit"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        400
    } else {
        500
    }
}
