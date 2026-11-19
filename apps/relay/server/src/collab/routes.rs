//! HTTP routes for co-editing: the socket, seeding, restore, unshare and grants.
#![allow(
    clippy::result_large_err,
    reason = "handlers return an early axum Response as the error"
)]

use std::collections::HashMap;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::{Value, json};
use wf_core::sync::instant::parse_instant;
use yrs::Update;
use yrs::updates::decoder::Decode;

use crate::auth::{bearer_token, require_session};
use crate::collab::hub::{self, Event, Room};
use crate::collab::protocol::event_json;
use crate::collab::store::{DocRow, DocStatus, NewGrant};
use crate::collab::update_log::is_safe_item_id;
use crate::collab::ws::ws_handler;
use crate::collab::{Authenticator, BoxFut, CollabState, Permission};
use crate::config::Config;

const SEED_KINDS: [&str; 4] = ["annotations", "canvas", "feed", "note"];
const RESTORE_KINDS: [&str; 3] = ["feed", "annotations", "canvas"];

/// Production Authenticator: wraps `crate::auth::require_session` (session JWT only, `tt_` refused).
pub struct SessionAuth {
    /// The HTTP client used to ask Supabase.
    pub client: reqwest::Client,
    /// Relay settings.
    pub config: Config,
}

impl Authenticator for SessionAuth {
    fn user_for<'a>(&'a self, token: &'a str) -> BoxFut<'a, Option<String>> {
        Box::pin(async move {
            let authorization = format!("Bearer {token}");
            require_session(&self.client, &self.config, Some(authorization.as_str()))
                .await
                .ok()
                .map(|caller| caller.user_id)
        })
    }
}

/// All co-editing routes, sharing `state`.
pub fn router(state: Arc<CollabState>) -> Router {
    Router::new()
        .route("/collab/ws/{item_id}", get(ws_handler))
        .route("/shared-docs/{item_id}", post(seed).delete(unshare))
        .route("/shared-docs/{item_id}/state", post(restore))
        .route("/grants", post(create_grant).get(list_grants))
        .route("/grants/{id}", delete(revoke_grant))
        .with_state(state)
}

/// Body of `POST /shared-docs/{item_id}`.
#[derive(Deserialize)]
struct SeedBody {
    kind: String,
    format_version: Option<i64>,
    state: Option<String>,
    project_id: Option<String>,
    workspace_id: Option<String>,
}

/// Body of `POST /shared-docs/{item_id}/state`.
#[derive(Deserialize)]
struct RestoreBody {
    kind: String,
    encoding: String,
    state: Value,
}

/// Body of `POST /grants`.
#[derive(Deserialize)]
struct GrantBody {
    scope: String,
    target_id: String,
    grantee_user: String,
    permission: String,
    expires_at: Option<String>,
}

/// The signed-in user, or a 401 reply.
async fn signed_in(state: &CollabState, headers: &HeaderMap) -> Result<String, Response> {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let token = bearer_token(authorization).ok_or_else(not_signed_in)?;
    state.auth.user_for(token).await.ok_or_else(not_signed_in)
}

/// The 401 reply for a missing or refused session.
fn not_signed_in() -> Response {
    json_error(StatusCode::UNAUTHORIZED, "Not signed in.")
}

/// A `{ "error": message }` reply with `status`.
fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// A 400 reply.
fn bad_request(message: &str) -> Response {
    json_error(StatusCode::BAD_REQUEST, message)
}

/// Logs a store failure and answers 500.
fn storage_failed(context: &str, error: &str) -> Response {
    eprintln!("collab {context}: {error}");
    json_error(StatusCode::INTERNAL_SERVER_ERROR, "Storage failed.")
}

/// Loads the document and checks the caller owns it (404 / 403 otherwise).
async fn require_owner(state: &CollabState, item_id: &str, user: &str) -> Result<(), Response> {
    let row = state
        .store
        .load(item_id)
        .await
        .map_err(|error| storage_failed("load", &error))?;
    match row {
        None => Err(json_error(StatusCode::NOT_FOUND, "No such document.")),
        Some(row) if row.owner != user => Err(json_error(
            StatusCode::FORBIDDEN,
            "Only the owner can do that.",
        )),
        Some(_) => Ok(()),
    }
}

/// Checks a seed body and returns the decoded initial state (empty when none).
fn seed_state(body: &SeedBody) -> Result<Vec<u8>, Response> {
    if !SEED_KINDS.contains(&body.kind.as_str()) {
        return Err(bad_request("Unknown kind."));
    }
    if body.format_version.is_some_and(|version| version < 1) {
        return Err(bad_request("format_version must be 1 or more."));
    }
    let text = body.state.as_deref().unwrap_or("");
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let bytes = STANDARD
        .decode(text)
        .map_err(|_| bad_request("state is not base64."))?;
    // Feeds are not co-edited, so their state is not a Yjs update.
    if body.kind != "feed" {
        let _: Update =
            Update::decode_v1(&bytes).map_err(|_| bad_request("state is not a Yjs update."))?;
    }
    Ok(bytes)
}

/// `POST /shared-docs/{item_id}`: the caller becomes the owner; an existing doc is kept.
async fn seed(
    State(state): State<Arc<CollabState>>,
    Path(item_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<SeedBody>,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    if !is_safe_item_id(&item_id) {
        return Err(bad_request("Item id is not a valid document id."));
    }
    let bytes = seed_state(&body)?;
    let row = DocRow {
        item_id,
        owner: user,
        kind: body.kind,
        project_id: body.project_id,
        workspace_id: body.workspace_id,
        epoch: 1,
        format_version: body.format_version.unwrap_or(1),
        state: bytes,
        status: DocStatus::Open,
    };
    state
        .store
        .seed(&row)
        .await
        .map_err(|error| storage_failed("seed", &error))?;
    // Seeding never replaces a row, so the row that now exists decides who may answer.
    let stored = state
        .store
        .load(&row.item_id)
        .await
        .map_err(|error| storage_failed("seed", &error))?;
    match stored {
        Some(doc) if doc.owner != row.owner => Err(json_error(
            StatusCode::CONFLICT,
            "Document is owned by another user.",
        )),
        // A closing doc is being deleted; re-sharing it now would race that delete.
        Some(doc) if doc.status == DocStatus::Closing => {
            Err(json_error(StatusCode::CONFLICT, "Document is closing."))
        }
        Some(_) => Ok(Json(json!({ "ok": true })).into_response()),
        None => Err(storage_failed("seed", "seeded row not found")),
    }
}

/// Marks the open room closing; true when a lease is live (the holder deletes on `lease.final`).
async fn mark_closing(state: &CollabState, room: &Room) -> bool {
    let live = {
        let mut inner = room.inner.lock().await;
        inner.status = DocStatus::Closing;
        inner.lease.live_holder(state.clock.now_ms()).is_some()
    };
    if live {
        room.send(Event::Text(event_json("closing")));
    }
    live
}

/// `DELETE /shared-docs/{item_id}`: unshares now, or once the live lease is released.
async fn unshare(
    State(state): State<Arc<CollabState>>,
    Path(item_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    require_owner(&state, &item_id, &user).await?;
    state
        .store
        .set_status(&item_id, DocStatus::Closing)
        .await
        .map_err(|error| storage_failed("unshare", &error))?;
    let live = match state.hub.get(&item_id) {
        Some(room) => mark_closing(&state, &room).await,
        None => false,
    };
    if live {
        return Ok((StatusCode::ACCEPTED, Json(json!({ "status": "closing" }))).into_response());
    }
    hub::close_doc(&state, &item_id)
        .await
        .map_err(|error| storage_failed("unshare", &error))?;
    Ok(Json(json!({ "status": "deleted" })).into_response())
}

/// The new state bytes for a restore body; a bad body is a 400.
fn restore_bytes(body: &RestoreBody) -> Result<Vec<u8>, Response> {
    match body.encoding.as_str() {
        "json" => serde_json::to_vec(&body.state).map_err(|_| bad_request("Bad state.")),
        "yjs-state" => {
            let text = body
                .state
                .as_str()
                .ok_or_else(|| bad_request("State must be base64."))?;
            let bytes = STANDARD
                .decode(text)
                .map_err(|_| bad_request("State is not base64."))?;
            let _: Update =
                Update::decode_v1(&bytes).map_err(|_| bad_request("State is not a Yjs update."))?;
            Ok(bytes)
        }
        _ => Err(bad_request("Unknown encoding.")),
    }
}

/// `POST /shared-docs/{item_id}/state`: replaces the state and bumps the epoch.
async fn restore(
    State(state): State<Arc<CollabState>>,
    Path(item_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<RestoreBody>,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    require_owner(&state, &item_id, &user).await?;
    if !RESTORE_KINDS.contains(&body.kind.as_str()) {
        return Err(bad_request("Unknown kind."));
    }
    let bytes = restore_bytes(&body)?;
    let epoch = hub::restore(&state, &item_id, &body.kind, &bytes)
        .await
        .map_err(|error| storage_failed("restore", &error))?;
    Ok(Json(json!({ "epoch": epoch })).into_response())
}

/// Checks a grant body and returns its permission (owner is never granted).
fn grant_permission(body: &GrantBody) -> Result<Permission, Response> {
    if body.scope != "item" && body.scope != "project" {
        return Err(bad_request("Unknown scope."));
    }
    if body.target_id.is_empty() || body.grantee_user.is_empty() {
        return Err(bad_request("target_id and grantee_user are required."));
    }
    if !is_uuid(&body.grantee_user) {
        return Err(bad_request("grantee_user must be a user id."));
    }
    if body
        .expires_at
        .as_deref()
        .is_some_and(|at| parse_instant(at).is_none() || !day_exists(at))
    {
        return Err(bad_request("expires_at must be an RFC 3339 timestamp."));
    }
    Permission::parse(&body.permission)
        .filter(|permission| *permission != Permission::Owner)
        .ok_or_else(|| bad_request("Unknown permission."))
}

/// True for the 8-4-4-4-12 hex form of a UUID (the grantee column is `uuid`).
fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

/// Whether the `YYYY-MM-DD` date at the start of `value` exists. `parse_instant` rolls day 30
/// of February forward, but Postgres refuses that date, so grants check it here.
/// Call only after `parse_instant` accepted `value`, so the digits are known to be there.
fn day_exists(value: &str) -> bool {
    let field =
        |range: std::ops::Range<usize>| value.get(range).and_then(|s| s.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day)) = (field(0..4), field(5..7), field(8..10)) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let last = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=last).contains(&day)
}

/// `POST /grants`: an item grant needs the caller to own the document.
async fn create_grant(
    State(state): State<Arc<CollabState>>,
    headers: HeaderMap,
    Json(body): Json<GrantBody>,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    let permission = grant_permission(&body)?;
    if body.scope == "item" {
        require_owner(&state, &body.target_id, &user).await?;
    }
    let grant = NewGrant {
        owner: user,
        scope: body.scope,
        target_id: body.target_id,
        grantee_user: body.grantee_user,
        permission,
        expires_at: body.expires_at,
    };
    let row = state
        .store
        .create_grant(&grant)
        .await
        .map_err(|error| storage_failed("grant", &error))?;
    Ok(Json(row).into_response())
}

/// `GET /grants?target_id=`: the caller's own grants.
async fn list_grants(
    State(state): State<Arc<CollabState>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    let target = query
        .get("target_id")
        .map(String::as_str)
        .filter(|target| !target.is_empty());
    let grants = state
        .store
        .list_grants(&user, target)
        .await
        .map_err(|error| storage_failed("list grants", &error))?;
    Ok(Json(json!({ "grants": grants })).into_response())
}

/// `DELETE /grants/{id}`: revokes the caller's grant and makes open sockets re-check.
async fn revoke_grant(
    State(state): State<Arc<CollabState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, Response> {
    let user = signed_in(&state, &headers).await?;
    if !is_uuid(&id) {
        return Err(bad_request("Unknown grant."));
    }
    let revoked = state
        .store
        .revoke_grant(&user, &id)
        .await
        .map_err(|error| storage_failed("revoke grant", &error))?;
    let Some(target) = revoked else {
        return Err(json_error(StatusCode::NOT_FOUND, "No such grant."));
    };
    // Only the rooms the grant covered need a recheck.
    state.hub.broadcast_affected(&target, &Event::Recheck);
    Ok(Json(json!({ "ok": true })).into_response())
}
