//! API and MCP token helpers: generation, hashing, expiry and row mapping, ported from api-token-service.ts.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use wf_core::sync::instant::format_instant;

/// Columns every token read returns.
pub const TOKEN_COLUMNS: &str = "id,name,token_prefix,expires_at,last_used_at,created_at,scopes";

/// Milliseconds in one day.
const DAY_MS: i64 = 86_400_000;

/// A new token: the one-time plaintext and what is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedToken {
    /// `tt_` plus base64url (no padding) of 32 random bytes; shown once.
    pub plaintext: String,
    /// `\x` plus the lowercase hex SHA-256 of the plaintext, in bytea form.
    pub hash_bytea: String,
    /// The first 11 characters of the plaintext followed by `…`.
    pub prefix: String,
}

/// Builds a token from 32 bytes; the same bytes always give the same token.
#[must_use]
pub fn token_from_bytes(bytes: &[u8; 32]) -> GeneratedToken {
    let plaintext = format!("tt_{}", URL_SAFE_NO_PAD.encode(bytes));
    let digest = Sha256::digest(plaintext.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    let prefix: String = plaintext.chars().take(11).collect();
    GeneratedToken {
        hash_bytea: format!("\\x{hex}"),
        prefix: format!("{prefix}…"),
        plaintext,
    }
}

/// A new token from OS randomness; fails rather than falling back to a weaker RNG.
pub fn generate_token() -> Result<GeneratedToken, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| "Could not generate a secure token.".to_string())?;
    Ok(token_from_bytes(&bytes))
}

/// The value as a whole number, if it is one (`5.0` counts; `1.5` and strings do not).
fn whole_number(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    if let Some(days) = value.as_i64() {
        return Some(days);
    }
    let number = value.as_f64()?;
    if number.fract() != 0.0 {
        return None;
    }
    // Formatting avoids an `as` cast; out-of-range values fail to parse and give None.
    format!("{number:.0}").parse().ok()
}

/// Whether an `expiresInDays` value is accepted: absent, null, or a whole number of days from 0 to 36500.
#[must_use]
pub fn is_expiry_days(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => true,
        Some(Value::Number(_)) => {
            matches!(whole_number(value), Some(days) if (0..=36500).contains(&days))
        }
        Some(_) => false,
    }
}

/// The expiry instant for `expiresInDays`, or None when no expiry applies (absent, null or zero or less).
#[must_use]
pub fn expiry_from_days(value: Option<&Value>, now_ms: i64) -> Option<String> {
    let days = whole_number(value)?;
    if days <= 0 {
        return None;
    }
    Some(format_instant(
        now_ms.saturating_add(days.saturating_mul(DAY_MS)),
    ))
}

/// A stored token row as the client sees it; `scopes` defaults to an empty list.
#[must_use]
pub fn map_row(row: &Value) -> Value {
    let field = |key: &str| row.get(key).cloned().unwrap_or(Value::Null);
    let scopes = match row.get("scopes") {
        None | Some(Value::Null) => json!([]),
        Some(scopes) => scopes.clone(),
    };
    json!({
        "id": field("id"),
        "name": field("name"),
        "tokenPrefix": field("token_prefix"),
        "expiresAt": field("expires_at"),
        "lastUsedAt": field("last_used_at"),
        "createdAt": field("created_at"),
        "scopes": scopes,
    })
}
