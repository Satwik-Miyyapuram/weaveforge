//! Legacy plaintext credential columns on `user_settings`: which rows still hold them,
//! and the patch that seals them into `credentials_enc` and clears the columns.

use serde_json::{Map, Value, json};

use crate::credential_crypto::seal;
use crate::postgrest::eq;

/// The plaintext columns that predate `credentials_enc`.
pub const LEGACY_COLUMNS: [&str; 3] = ["zotero_api_key", "semantic_scholar_key", "integrations"];

/// PostgREST `or` filter: the row still holds some legacy plaintext column. Used in every
/// guarded write, so a row whose keys were cleared after it was read is not rewritten.
pub const HAS_LEGACY_OR: &str =
    "(zotero_api_key.not.is.null,semantic_scholar_key.not.is.null,integrations.not.is.null)";

/// Each legacy column and its key in the secrets object.
const SECRET_KEYS: [(&str, &str); 3] = [
    ("zotero_api_key", "zoteroApiKey"),
    ("semantic_scholar_key", "semanticScholarKey"),
    ("integrations", "integrations"),
];

/// The legacy values of a row that holds legacy plaintext and no envelope, exactly as
/// stored (not cleaned), keyed like the secrets object. Sealing these and nulling the
/// columns loses nothing; readers clean the opened envelope.
///
/// `None` when the row is sealed or has no legacy value at all.
#[must_use]
pub fn legacy_secrets(row: &Value) -> Option<Map<String, Value>> {
    let sealed = row
        .get("credentials_enc")
        .and_then(Value::as_str)
        .is_some_and(|envelope| !envelope.is_empty());
    if sealed {
        return None;
    }
    let mut out = Map::new();
    for (column, key) in SECRET_KEYS {
        if let Some(value) = row.get(column).filter(|value| !value.is_null()) {
            let _old = out.insert(key.to_owned(), value.clone());
        }
    }
    (!out.is_empty()).then_some(out)
}

/// PostgREST filters for a guarded write of `user_id`'s row: it matches only while the
/// envelope and every legacy column still hold exactly the values in `row`, so a value
/// written after the read (a new key from an old client, a seal, a clear) is never
/// overwritten. A miss leaves the row as it is.
#[must_use]
pub fn legacy_guard(user_id: &str, row: &Value) -> Vec<(&'static str, String)> {
    let mut guard = vec![("user_id", eq(user_id)), ("or", HAS_LEGACY_OR.to_string())];
    for column in [
        "credentials_enc",
        "zotero_api_key",
        "semantic_scholar_key",
        "integrations",
    ] {
        let filter = match row.get(column) {
            None | Some(Value::Null) => "is.null".to_string(),
            Some(Value::String(text)) if column != "integrations" => eq(text),
            // jsonb: PostgreSQL compares the parsed values, so key order and spacing do not matter.
            Some(value) => eq(&value.to_string()),
        };
        guard.push((column, filter));
    }
    guard
}

/// The `user_settings` patch that stores `secrets` sealed and clears the legacy columns.
/// Empty `secrets` clear the columns and leave `credentials_enc` null, with no key needed.
///
/// # Errors
/// The seal error (the missing-key message when no credential key is configured).
pub fn seal_patch(secrets: &Map<String, Value>, key: Option<&str>) -> Result<Value, String> {
    let credentials_enc = if secrets.is_empty() {
        Value::Null
    } else {
        Value::String(seal(&Value::Object(secrets.clone()).to_string(), key)?)
    };
    Ok(json!({
        "credentials_enc": credentials_enc,
        "zotero_api_key": null,
        "semantic_scholar_key": null,
        "integrations": null,
    }))
}
