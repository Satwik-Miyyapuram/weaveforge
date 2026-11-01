//! Lab (organization) invites: the service behind /api/org/*, ported from OrgInviteService.

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use wf_core::org::{
    ORG_INVITE_ROLES, invite_code_from_bytes, normalize_invite_code, validate_org_name,
};
use wf_core::sync::instant::format_instant;

use crate::postgrest::{DbError, UserDb, eq, in_list};
use crate::routes::AppState;
use crate::safe_error::format_error_for_response;

/// How many times a code collision is retried before giving up.
pub(crate) const CODE_ATTEMPTS: usize = 5;

/// PostgreSQL unique_violation: the only error worth retrying a code insert for.
pub(crate) const UNIQUE_VIOLATION: &str = "23505";

/// The columns the lab mappers read, named rather than starred.
pub(crate) const ORG_COLUMNS: &str = "id,name,owner_id,created_at";

/// A failed lab operation, with the HTTP status it maps to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrgError {
    /// The request was invalid (400).
    Validation(String),
    /// The caller may not do this (403).
    Permission(String),
    /// The lab or code does not exist (404).
    NotFound(String),
    /// A database call failed (500); the reply is built from the error by `format_error_for_response`.
    Db(DbError),
    /// A server-side failure with a message safe to show (500).
    Server(String),
}

impl OrgError {
    /// The HTTP status for this error.
    #[must_use]
    pub fn status(&self) -> u16 {
        match self {
            Self::Validation(_) => 400,
            Self::Permission(_) => 403,
            Self::NotFound(_) => 404,
            Self::Db(_) | Self::Server(_) => 500,
        }
    }

    /// The message sent to the caller; raw database text is never returned.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::Validation(message)
            | Self::Permission(message)
            | Self::NotFound(message)
            | Self::Server(message) => message.clone(),
            Self::Db(err) => format_error_for_response(err, "org"),
        }
    }
}

impl From<DbError> for OrgError {
    fn from(err: DbError) -> Self {
        Self::Db(err)
    }
}

/// Lab operations as the service role; each call is one request chain.
pub struct OrgService<'a> {
    db: UserDb<'a>,
    client: &'a reqwest::Client,
    supabase_url: &'a str,
    service_key: &'a str,
}

impl<'a> OrgService<'a> {
    /// A service that runs its queries with the service role key.
    #[must_use]
    pub fn new(state: &'a AppState) -> Self {
        let config = &state.config;
        Self {
            db: UserDb::new(
                &state.client,
                &config.data_url,
                &config.service_role_key,
                &config.service_role_key,
            ),
            client: &state.client,
            supabase_url: &config.supabase_url,
            service_key: &config.service_role_key,
        }
    }

    /// The admin database client, for the sibling `org_members` module.
    pub(crate) fn db(&self) -> &UserDb<'a> {
        &self.db
    }

    /// Makes sure the user has a profiles row; legacy users may predate auto-provisioning.
    pub async fn ensure_profile(&self, user_id: &str) -> Result<(), OrgError> {
        let user = self.admin_user(user_id).await?;
        let email = text(&user, "email");
        let full_name = user
            .get("user_metadata")
            .and_then(|meta| text(meta, "full_name"));
        let row = json!({
            "user_id": user_id,
            "email": email,
            "full_name": full_name.or_else(|| email.clone()),
            "role": "masters",
            "org_setup_complete": false,
        });
        self.db.insert_ignore("profiles", &row, "user_id").await?;
        Ok(())
    }

    /// Creates a lab with its three invite codes; the codes are returned in plaintext once.
    pub async fn create_organization(&self, user_id: &str, name: &str) -> Result<Value, OrgError> {
        self.ensure_profile(user_id).await?;
        let name =
            validate_org_name(name).map_err(|message| OrgError::Validation(message.to_string()))?;
        for _ in 0..CODE_ATTEMPTS {
            let codes: Vec<(&str, String)> = ORG_INVITE_ROLES
                .iter()
                .map(|role| (*role, new_invite_code()))
                .collect();
            let args = json!({
                "p_user_id": user_id,
                "p_name": name,
                "p_codes": codes
                    .iter()
                    .map(|(role, code)| json!({"target_role": role, "code_hash": invite_code_hash(code)}))
                    .collect::<Vec<Value>>(),
            });
            match self.db.rpc("create_organization_atomic", &args).await {
                Ok(row) if !row.is_null() => {
                    return Ok(json!({
                        "organization": org_json(&row),
                        "codes": codes
                            .iter()
                            .map(|(role, code)| json!({"targetRole": role, "code": code}))
                            .collect::<Vec<Value>>(),
                    }));
                }
                // A null reply is retried, as the TS service does.
                Ok(_) => {}
                Err(err) if is_unique_violation(&err) => {}
                Err(err) => return Err(OrgError::Db(err)),
            }
        }
        Err(code_collision())
    }

    /// Revokes the role's live code in a lab and issues a new one; owner only.
    pub async fn regenerate_code(
        &self,
        user_id: &str,
        org_id: &str,
        target_role: &str,
    ) -> Result<Value, OrgError> {
        let owners = self
            .db
            .select(
                "organizations",
                &[("select", "owner_id".to_string()), ("id", eq(org_id))],
            )
            .await?;
        let owner = first(owners).and_then(|row| text(&row, "owner_id"));
        if owner.as_deref() != Some(user_id) {
            return Err(OrgError::Permission(
                "Only the lab owner can regenerate codes.".to_string(),
            ));
        }
        // A failed revoke leaves the old code valid, so no new one is made.
        self.db
            .update(
                "org_invite_codes",
                &[
                    ("org_id", eq(org_id)),
                    ("target_role", eq(target_role)),
                    ("revoked_at", "is.null".to_string()),
                ],
                &json!({"revoked_at": now_iso()}),
            )
            .await?;
        for _ in 0..CODE_ATTEMPTS {
            let code = new_invite_code();
            let row = json!({
                "org_id": org_id,
                "target_role": target_role,
                "code_hash": invite_code_hash(&code),
            });
            match self.db.insert("org_invite_codes", &row).await {
                Ok(()) => return Ok(json!({"targetRole": target_role, "code": code})),
                Err(err) if is_unique_violation(&err) => {}
                Err(err) => return Err(OrgError::Db(err)),
            }
        }
        Err(code_collision())
    }

    /// Looks up a live join code; `None` when the code or its lab is unknown.
    pub async fn preview_code(&self, code: &str) -> Result<Option<Value>, OrgError> {
        let codes = self
            .db
            .select(
                "org_invite_codes",
                &[
                    ("select", "org_id,target_role".to_string()),
                    ("code_hash", eq(&invite_code_hash(code))),
                    ("revoked_at", "is.null".to_string()),
                    ("limit", "1".to_string()),
                ],
            )
            .await?;
        let Some(code_row) = first(codes) else {
            return Ok(None);
        };
        let Some(org_id) = text(&code_row, "org_id") else {
            return Ok(None);
        };
        let target = text(&code_row, "target_role").unwrap_or_default();
        let orgs = self
            .db
            .select(
                "organizations",
                &[
                    ("select", "name".to_string()),
                    ("id", eq(&org_id)),
                    ("limit", "1".to_string()),
                ],
            )
            .await?;
        let Some(org_name) = first(orgs).and_then(|row| text(&row, "name")) else {
            return Ok(None);
        };
        let professors = self.member_ids(&org_id, "professor").await?;
        let phds = self.member_ids(&org_id, "phd").await?;
        let mut preview = json!({"orgName": org_name, "targetRole": target});
        if target == "phd" && professors.len() > 1 {
            preview["professors"] = self.labels(&professors).await?;
        }
        if target == "masters" {
            preview["phds"] = self.labels(&phds).await?;
        }
        Ok(Some(preview))
    }

    /// The user ids of a lab's members with `role`.
    pub(crate) async fn member_ids(
        &self,
        org_id: &str,
        role: &str,
    ) -> Result<Vec<String>, OrgError> {
        let rows = self
            .db
            .select(
                "org_memberships",
                &[
                    ("select", "user_id".to_string()),
                    ("org_id", eq(org_id)),
                    ("role", eq(role)),
                ],
            )
            .await?;
        Ok(rows.iter().filter_map(|row| text(row, "user_id")).collect())
    }

    /// `[{id, label}]` for the given profile ids; the label falls back to email, then "Member".
    async fn labels(&self, ids: &[String]) -> Result<Value, OrgError> {
        if ids.is_empty() {
            return Ok(json!([]));
        }
        let profiles = self
            .db
            .select(
                "profiles",
                &[
                    ("select", "user_id,full_name,email".to_string()),
                    ("user_id", in_list(ids)),
                ],
            )
            .await?;
        let labels: Vec<Value> = profiles
            .iter()
            .map(|profile| {
                let label = text(profile, "full_name")
                    .or_else(|| text(profile, "email"))
                    .unwrap_or_else(|| "Member".to_string());
                json!({"id": text(profile, "user_id").unwrap_or_default(), "label": label})
            })
            .collect();
        Ok(Value::Array(labels))
    }

    /// The auth user record for `user_id`; any failure reads as "User not found.".
    async fn admin_user(&self, user_id: &str) -> Result<Value, OrgError> {
        let url = format!("{}/auth/v1/admin/users/{user_id}", self.supabase_url);
        let not_found = || OrgError::Validation("User not found.".to_string());
        let response = self
            .client
            .get(url)
            .header("apikey", self.service_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .send()
            .await
            .map_err(|_| not_found())?;
        let status = response.status();
        let bytes = response.bytes().await.unwrap_or_default();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if !status.is_success() {
            let message = text(&body, "msg")
                .or_else(|| text(&body, "message"))
                .unwrap_or_else(|| "User not found.".to_string());
            return Err(OrgError::Validation(message));
        }
        Ok(body)
    }
}

/// The SHA-256 hex of a code after normalizing it; the only form a code is stored in.
#[must_use]
pub fn invite_code_hash(code: &str) -> String {
    let digest = Sha256::digest(normalize_invite_code(code).as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A new random invite code; falls back to a hasher-seeded value if the OS source fails.
#[must_use]
pub fn new_invite_code() -> String {
    let mut bytes = [0u8; 10];
    if getrandom::getrandom(&mut bytes).is_err() {
        bytes = fallback_bytes();
    }
    invite_code_from_bytes(&bytes)
}

/// Ten bytes from a randomly keyed hasher; used only when the OS random source fails.
fn fallback_bytes() -> [u8; 10] {
    let state = RandomState::new();
    let high = state.hash_one(0u64).to_be_bytes();
    let low = state.hash_one(1u64).to_be_bytes();
    let mut out = [0u8; 10];
    for (slot, byte) in out.iter_mut().zip(high.iter().chain(low.iter())) {
        *slot = *byte;
    }
    out
}

/// The PostgREST `message` inside a database error, when the error body carries one.
#[must_use]
pub fn db_error_message(err: &DbError) -> Option<String> {
    let body = strip_status_prefix(&err.message);
    let value: Value = serde_json::from_str(body).ok()?;
    text(&value, "message")
}

/// Drops a leading `HTTP {status}: ` that the query layer puts in front of a reply body.
fn strip_status_prefix(message: &str) -> &str {
    let Some(rest) = message.strip_prefix("HTTP ") else {
        return message;
    };
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    match rest.get(digits..).and_then(|tail| tail.strip_prefix(": ")) {
        Some(body) if digits > 0 => body,
        _ => message,
    }
}

/// The first row of a query, if there is one.
#[must_use]
pub(crate) fn first(rows: Vec<Value>) -> Option<Value> {
    rows.into_iter().next()
}

/// A string field of `row`; `None` when it is missing or not a string.
#[must_use]
pub(crate) fn text(row: &Value, key: &str) -> Option<String> {
    row.get(key)?.as_str().map(str::to_string)
}

/// The API shape of a lab row (`Organization`).
fn org_json(row: &Value) -> Value {
    json!({
        "id": text(row, "id"),
        "name": text(row, "name"),
        "ownerId": text(row, "owner_id"),
        "createdAt": text(row, "created_at"),
    })
}

fn is_unique_violation(err: &DbError) -> bool {
    err.code.as_deref() == Some(UNIQUE_VIOLATION)
}

fn code_collision() -> OrgError {
    OrgError::Server("Could not generate a unique code.".to_string())
}

/// The current time as an ISO-8601 string, for `revoked_at`.
fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    format_instant(i64::try_from(millis).unwrap_or(0))
}
