//! Supabase Auth (GoTrue) calls for account deletion and admin user creation, as the
//! web's supabase-auth provider makes them. Also resolves the caller's member profile.
//! Ported from apps/web/src/backend/providers/supabase-auth/.

use reqwest::Method;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};
use wf_core::member::OtpInput;

use crate::postgrest::{DbError, UserDb, eq};
use crate::routes::AppState;

const UNREACHABLE: &str = "Could not reach the auth server.";

/// A caller's member profile, as the lab roles see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// The Supabase user id.
    pub id: String,
    /// The account email, if the profile has one.
    pub email: Option<String>,
    /// The display name, if the profile has one.
    pub full_name: Option<String>,
    /// The lab role (`standalone`, `masters`, `phd`, `professor`), or "" when unset.
    pub role: String,
    /// The supervising member's id, if any.
    pub supervisor_id: Option<String>,
}

impl Member {
    /// The API shape of a member; absent fields are left out, as `JSON.stringify` does.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let mut out = json!({"id": self.id, "role": self.role});
        if let Some(email) = &self.email {
            out["email"] = json!(email);
        }
        if let Some(full_name) = &self.full_name {
            out["fullName"] = json!(full_name);
        }
        if let Some(supervisor_id) = &self.supervisor_id {
            out["supervisorId"] = json!(supervisor_id);
        }
        out
    }
}

/// The Supabase user behind a session token, or `None` when Supabase refuses it.
pub async fn session_user_id(state: &AppState, token: &str) -> Option<String> {
    let request = state
        .client
        .get(format!("{}/auth/v1/user", state.config.supabase_url))
        .header("apikey", state.config.anon_key.as_str())
        .header(AUTHORIZATION, format!("Bearer {token}"));
    let answer = send(request).await.ok()?;
    if !answer.ok {
        return None;
    }
    answer.body.get("id")?.as_str().map(str::to_owned)
}

/// The caller's member profile; `None` when the session is invalid or has no profile.
pub async fn resolve_member(state: &AppState, token: &str) -> Result<Option<Member>, DbError> {
    let Some(user_id) = session_user_id(state, token).await else {
        return Ok(None);
    };
    let db = UserDb::new(
        &state.client,
        &state.config.data_url,
        &state.config.service_role_key,
        &state.config.service_role_key,
    );
    let rows = db
        .select(
            "profiles",
            &[
                (
                    "select",
                    "user_id,email,full_name,role,supervisor_id".to_string(),
                ),
                ("user_id", eq(&user_id)),
            ],
        )
        .await?;
    Ok(rows.first().map(|row| Member {
        id: user_id,
        email: field(row, "email"),
        full_name: field(row, "full_name"),
        role: field(row, "role").unwrap_or_default(),
        supervisor_id: field(row, "supervisor_id"),
    }))
}

/// Creates a confirmed auth user; the new user's id, or the auth server's message.
pub async fn admin_create_user(
    state: &AppState,
    email: &str,
    password: &str,
    full_name: Option<&str>,
) -> Result<String, String> {
    let mut body = json!({"email": email, "password": password, "email_confirm": true});
    if let Some(full_name) = full_name {
        body["user_metadata"] = json!({"full_name": full_name});
    }
    let answer = send(admin(state, Method::POST, "/auth/v1/admin/users", &body)).await?;
    if !answer.ok {
        return Err(auth_message(&answer.body, "Failed to create user."));
    }
    user_id_of(&answer.body).ok_or_else(|| "Failed to create user.".to_string())
}

/// Deletes an auth user outright; the auth server's message on refusal.
pub async fn admin_delete_user(state: &AppState, user_id: &str) -> Result<(), String> {
    let body = json!({"should_soft_delete": false});
    let path = format!("/auth/v1/admin/users/{user_id}");
    let answer = send(admin(state, Method::DELETE, &path, &body)).await?;
    if answer.ok {
        Ok(())
    } else {
        Err(auth_message(&answer.body, "Failed to delete user."))
    }
}

/// Emails a one-time code to `email`; no account is created for an unknown address.
pub async fn send_email_otp(state: &AppState, email: &str) -> Result<(), String> {
    let body = json!({"email": email, "create_user": false});
    let answer = send(anon(state, Method::POST, "/auth/v1/otp", &body)).await?;
    if answer.ok {
        Ok(())
    } else {
        Err(auth_message(
            &answer.body,
            "Failed to send confirmation code.",
        ))
    }
}

/// Checks an emailed code or link; the verified user's id, or why it was refused.
pub async fn verify_email_otp(
    state: &AppState,
    email: &str,
    otp: &OtpInput,
) -> Result<String, String> {
    let body = match otp {
        OtpInput::Token(token) => json!({"type": "email", "email": email, "token": token}),
        OtpInput::TokenHash(hash) => json!({"type": "email", "token_hash": hash}),
    };
    let answer = send(anon(state, Method::POST, "/auth/v1/verify", &body)).await?;
    if !answer.ok {
        return Err(auth_message(
            &answer.body,
            "Invalid or expired confirmation code.",
        ));
    }
    user_id_of(&answer.body).ok_or_else(|| "Invalid or expired confirmation code.".to_string())
}

/// A reply from the auth server: whether it succeeded, and its JSON body (`Null` when not JSON).
struct Answer {
    ok: bool,
    body: Value,
}

/// Sends `request` and reads the reply; a send failure is the unreachable message.
async fn send(request: reqwest::RequestBuilder) -> Result<Answer, String> {
    let response = request.send().await.map_err(|_| UNREACHABLE.to_string())?;
    let ok = response.status().is_success();
    let bytes = response.bytes().await.unwrap_or_default();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Ok(Answer { ok, body })
}

/// A call to the auth server as the service role.
fn admin(state: &AppState, method: Method, path: &str, body: &Value) -> reqwest::RequestBuilder {
    authed(state, method, path, &state.config.service_role_key, body)
}

/// A call to the auth server with the anon key.
fn anon(state: &AppState, method: Method, path: &str, body: &Value) -> reqwest::RequestBuilder {
    authed(state, method, path, &state.config.anon_key, body)
}

/// A JSON call to the auth server, authorized with `key` as both `apikey` and bearer.
fn authed(
    state: &AppState,
    method: Method,
    path: &str,
    key: &str,
    body: &Value,
) -> reqwest::RequestBuilder {
    state
        .client
        .request(method, format!("{}{path}", state.config.supabase_url))
        .header("apikey", key)
        .header(AUTHORIZATION, format!("Bearer {key}"))
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string())
}

/// The first non-empty `msg`, `message`, `error_description` or `error` of an auth reply.
fn auth_message(body: &Value, fallback: &str) -> String {
    ["msg", "message", "error_description", "error"]
        .iter()
        .find_map(|key| {
            body.get(*key)
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
        })
        .map_or_else(|| fallback.to_string(), str::to_owned)
}

/// The user id of an auth reply: `user.id` (verify, create) or a bare `id`.
fn user_id_of(body: &Value) -> Option<String> {
    body.get("user")
        .and_then(|user| user.get("id"))
        .or_else(|| body.get("id"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// A string column of a row; `None` when missing, null or not a string.
fn field(row: &Value, key: &str) -> Option<String> {
    row.get(key)?.as_str().map(str::to_owned)
}
