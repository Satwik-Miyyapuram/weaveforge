//! Legacy plaintext credential columns on `user_settings`: which rows still hold them,
//! and the patch that seals them into `credentials_enc` and clears the columns.

use serde_json::{Map, Value, json};

use crate::credential_crypto::seal;
use crate::credentials::clean_secrets;

/// The plaintext columns that predate `credentials_enc`.
pub const LEGACY_COLUMNS: [&str; 3] = ["zotero_api_key", "semantic_scholar_key", "integrations"];

/// The cleaned secrets of a row that holds legacy plaintext and no envelope.
///
/// `None` when the row is sealed or has no legacy value at all. `Some` of an empty map
/// means every legacy value was blank: the columns still need clearing.
#[must_use]
pub fn legacy_secrets(row: &Value) -> Option<Map<String, Value>> {
    let sealed = row
        .get("credentials_enc")
        .and_then(Value::as_str)
        .is_some_and(|envelope| !envelope.is_empty());
    if sealed {
        return None;
    }
    let any_legacy = LEGACY_COLUMNS
        .iter()
        .any(|column| row.get(*column).is_some_and(|value| !value.is_null()));
    if !any_legacy {
        return None;
    }
    Some(clean_secrets(&json!({
        "zoteroApiKey": row.get("zotero_api_key"),
        "semanticScholarKey": row.get("semantic_scholar_key"),
        "integrations": row.get("integrations"),
    })))
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
