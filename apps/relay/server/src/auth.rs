//! Caller authentication for the relay: a Supabase session JWT, or an SDK API
//! token exchanged for one. Port of `requireSdkUser` in
//! `apps/web/src/app/api/sdk/_shared.ts`.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::config::Config;

const API_TOKEN_PREFIX: &str = "tt_";
const JWT_LIFETIME_SECONDS: u64 = 3600;
const JWT_HEADER: &str = r#"{"alg":"HS256","typ":"JWT"}"#;
const NOT_AUTHENTICATED: &str = "Not authenticated.";
const SESSION_REFUSED: &str = "Invalid session.";
const API_TOKEN_REFUSED: &str = "Invalid or expired API token.";
const PLAN_FEED_REFUSED: &str = "Unknown or revoked feed link.";
const MISSING_SECRET: &str = "Server is missing SUPABASE_JWT_SECRET for API token auth.";
const SERVER_ERROR: &str = "Something went wrong on the server.";

/// A refused caller: the HTTP status and the `error` text to answer with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthError {
    /// HTTP status code.
    pub status: u16,
    /// Message for the `{ "error": … }` body.
    pub message: String,
}

impl AuthError {
    fn new(status: u16, message: &str) -> Self {
        Self {
            status,
            message: message.to_owned(),
        }
    }
}

/// A verified caller: the Supabase user id and the JWT to act with as that user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// Supabase user id.
    pub user_id: String,
    /// Bearer JWT for PostgREST calls made as this user.
    pub access_token: String,
}

/// Authenticates a request and returns the Supabase user id it acts for.
pub async fn require_user(
    client: &reqwest::Client,
    config: &Config,
    authorization: Option<&str>,
) -> Result<String, AuthError> {
    require_caller(client, config, authorization)
        .await
        .map(|caller| caller.user_id)
}

/// Authenticates a request and returns the user id plus the token to act with.
pub async fn require_caller(
    client: &reqwest::Client,
    config: &Config,
    authorization: Option<&str>,
) -> Result<Caller, AuthError> {
    let token =
        bearer_token(authorization).ok_or_else(|| AuthError::new(401, NOT_AUTHENTICATED))?;
    if is_api_token(token) {
        return scoped_token_user(
            client,
            config,
            token,
            "sdk",
            "resolve_api_token",
            API_TOKEN_REFUSED,
            Some(MISSING_SECRET),
        )
        .await;
    }
    // Not a JWT either: no session could match it, and asking Supabase would
    // turn a bad credential into a server error.
    if !looks_like_jwt(token) {
        return Err(AuthError::new(401, SESSION_REFUSED));
    }
    let user_id = get_user(client, config, token)
        .await
        .ok_or_else(|| AuthError::new(401, SESSION_REFUSED))?;
    Ok(Caller {
        user_id,
        access_token: token.to_owned(),
    })
}

/// Authenticates a signed-in session only: org routes refuse API tokens, as `requireOrgApiUser` does.
pub async fn require_session(
    client: &reqwest::Client,
    config: &Config,
    authorization: Option<&str>,
) -> Result<Caller, AuthError> {
    let token =
        bearer_token(authorization).ok_or_else(|| AuthError::new(401, NOT_AUTHENTICATED))?;
    if !looks_like_jwt(token) {
        return Err(AuthError::new(401, SESSION_REFUSED));
    }
    let user_id = get_user(client, config, token)
        .await
        .ok_or_else(|| AuthError::new(401, SESSION_REFUSED))?;
    Ok(Caller {
        user_id,
        access_token: token.to_owned(),
    })
}

/// Authenticates a plan-feed link: a `plan_feed`-scoped API token only.
pub async fn require_plan_feed(
    client: &reqwest::Client,
    config: &Config,
    token: &str,
) -> Result<Caller, AuthError> {
    if !is_api_token(token) {
        return Err(AuthError::new(401, PLAN_FEED_REFUSED));
    }
    scoped_token_user(
        client,
        config,
        token,
        "plan_feed",
        "resolve_plan_feed_token",
        PLAN_FEED_REFUSED,
        None,
    )
    .await
}

/// Exchanges a token of `scope` for a minted JWT, then asks Supabase who it is.
/// A missing JWT secret is `missing_secret` as a 503, or `refused` as a 401 when `None`.
async fn scoped_token_user(
    client: &reqwest::Client,
    config: &Config,
    token: &str,
    scope: &str,
    resolve_rpc: &str,
    refused: &str,
    missing_secret: Option<&str>,
) -> Result<Caller, AuthError> {
    // Scopes are read before any JWT is minted, so a token of the wrong scope
    // never reaches the resolve RPC.
    let scopes = rpc(client, config, "api_token_scopes", token).await?;
    if !has_scope(&scopes, scope) {
        return Err(AuthError::new(401, refused));
    }
    let secret = config
        .jwt_secret
        .as_deref()
        .ok_or_else(|| match missing_secret {
            Some(message) => AuthError::new(503, message),
            None => AuthError::new(401, refused),
        })?;
    let resolved = rpc(client, config, resolve_rpc, token).await?;
    let user_id = resolved
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AuthError::new(401, refused))?;
    let jwt = mint_jwt(secret, user_id, now_seconds());
    let verified = get_user(client, config, &jwt)
        .await
        .ok_or_else(|| AuthError::new(401, refused))?;
    Ok(Caller {
        user_id: verified,
        access_token: jwt,
    })
}

/// The token in `Authorization: Bearer <token>`, as the web's `bearerToken` reads it.
#[must_use]
pub fn bearer_token(authorization: Option<&str>) -> Option<&str> {
    let value = authorization?;
    let stripped = value
        .get(..6)
        .filter(|prefix| prefix.eq_ignore_ascii_case("bearer"))
        .and_then(|_| value.get(6..))
        .and_then(|rest| {
            let trimmed = rest.trim_start_matches(is_js_space);
            (trimmed.len() < rest.len()).then_some(trimmed)
        });
    Some(stripped.unwrap_or(value)).filter(|token| !token.is_empty())
}

/// JavaScript's `\s` class, which `bearerToken` strips with.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `isApiTokenFormat`: the `tt_` prefix and more than 19 UTF-16 units.
fn is_api_token(token: &str) -> bool {
    token.starts_with(API_TOKEN_PREFIX) && token.encode_utf16().count() > 19
}

/// A shape test only: three non-empty base64url segments. Signature checking is Supabase's job.
fn looks_like_jwt(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
}

/// Lower-case hex SHA-256 of the token's UTF-8 bytes (`hashApiToken`).
fn token_hash_hex(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Mints the HS256 access JWT that `signAccessJwt` makes, valid for one hour from `now` (Unix seconds).
#[must_use]
pub fn mint_jwt(secret: &str, user_id: &str, now: u64) -> String {
    let header = URL_SAFE_NO_PAD.encode(JWT_HEADER);
    let payload = format!(
        r#"{{"aud":"authenticated","exp":{},"iat":{now},"sub":{},"role":"authenticated"}}"#,
        now.saturating_add(JWT_LIFETIME_SECONDS),
        serde_json::Value::String(user_id.to_owned()),
    );
    let data = format!("{header}.{}", URL_SAFE_NO_PAD.encode(payload));
    let signature = hs256_b64(secret, &data);
    format!("{data}.{signature}")
}

fn hs256_b64(secret: &str, data: &str) -> String {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        // HMAC accepts a key of any length, so this branch cannot run.
        return String::new();
    };
    mac.update(data.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn has_scope(scopes: &serde_json::Value, scope: &str) -> bool {
    scopes
        .as_array()
        .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(scope)))
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn server_error() -> AuthError {
    AuthError::new(500, SERVER_ERROR)
}

/// Calls a PostgREST RPC with the token's hash; the parsed reply, or a 500 when the RPC failed.
async fn rpc(
    client: &reqwest::Client,
    config: &Config,
    name: &str,
    token: &str,
) -> Result<serde_json::Value, AuthError> {
    let body = serde_json::json!({ "p_token_hash": format!("\\x{}", token_hash_hex(token)) });
    let service = config.service_role_key.as_str();
    let response = client
        .post(format!("{}/rpc/{name}", config.data_url))
        .header("apikey", service)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {service}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|_| server_error())?;
    if !response.status().is_success() {
        return Err(server_error());
    }
    let text = response.text().await.map_err(|_| server_error())?;
    serde_json::from_str(&text).map_err(|_| server_error())
}

/// The Supabase user behind a JWT, or `None` when Supabase refuses it (`auth.getUser`).
async fn get_user(client: &reqwest::Client, config: &Config, token: &str) -> Option<String> {
    let response = client
        .get(format!("{}/auth/v1/user", config.supabase_url))
        .header("apikey", config.anon_key.as_str())
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("id")?.as_str().map(str::to_owned)
}
