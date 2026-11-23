//! The one-shot `seal-legacy-credentials` run: seals every `user_settings` row that still
//! holds plaintext legacy credentials. Re-running it finds nothing left to do.

use serde_json::Value;

use crate::config::Config;
use crate::credential_crypto::MISSING_KEY;
use crate::legacy_credentials::{HAS_LEGACY_OR, legacy_guard, legacy_secrets, seal_patch};
use crate::postgrest::{DbError, UserDb};

/// Rows fetched per page.
const PAGE: usize = 200;

/// What a run did. Counts only: no value is ever reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// Rows that hold legacy plaintext and no envelope.
    pub found: usize,
    /// Rows written this run (always 0 on a dry run).
    pub converted: usize,
    /// Rows with an envelope that still hold plaintext (saved later by an older client).
    /// Left as they are: the envelope wins. Counted so the operator can see them.
    pub left_plaintext: usize,
    /// Whether this run only counted.
    pub dry_run: bool,
}

/// Seals every legacy row, service-role, one row at a time.
///
/// Refuses before any database call when `key` (the credential key) is missing. With
/// `dry_run` it reads and counts but writes nothing. Each write only lands while the row
/// still holds exactly the values read (`legacy_guard`), so a row changed meanwhile is left
/// alone and a key is never lost.
///
/// # Errors
/// The missing-key message, or a database failure described by its error code only.
pub async fn seal_legacy_credentials(
    config: &Config,
    client: &reqwest::Client,
    key: Option<&str>,
    dry_run: bool,
) -> Result<Report, String> {
    if key.is_none() {
        return Err(MISSING_KEY.to_string());
    }
    let db = UserDb::new(
        client,
        &config.data_url,
        &config.anon_key,
        &config.service_role_key,
    );
    let mut report = Report {
        found: 0,
        converted: 0,
        left_plaintext: 0,
        dry_run,
    };
    let mut after: Option<String> = None;
    loop {
        let mut query = vec![
            (
                "select",
                "user_id,credentials_enc,zotero_api_key,semantic_scholar_key,integrations"
                    .to_string(),
            ),
            // No `credentials_enc` filter: `legacy_secrets` skips sealed rows, and an empty
            // envelope must still be sealed.
            ("or", HAS_LEGACY_OR.to_string()),
            ("order", "user_id.asc".to_string()),
            ("limit", PAGE.to_string()),
        ];
        if let Some(id) = &after {
            query.push(("user_id", format!("gt.{id}")));
        }
        let rows = db
            .select("user_settings", &query)
            .await
            .map_err(|err| db_error("read", &err))?;
        if rows.is_empty() {
            break;
        }
        for row in &rows {
            // The read only returns rows holding plaintext, so `None` means a sealed row.
            let Some(secrets) = legacy_secrets(row) else {
                report.left_plaintext += 1;
                continue;
            };
            report.found += 1;
            if dry_run {
                continue;
            }
            let user = user_id_of(row)?;
            let patch = seal_patch(&secrets, key)?;
            let guard = legacy_guard(user, row);
            let written = db
                .update_returning("user_settings", &guard, &patch)
                .await
                .map_err(|err| db_error("write", &err))?;
            // No row matched: the row changed after it was read, so it is left as it is.
            if written.is_empty() {
                continue;
            }
            report.converted += 1;
        }
        let Some(last) = rows.last() else {
            break;
        };
        after = Some(user_id_of(last)?.to_owned());
        if rows.len() < PAGE {
            break;
        }
    }
    Ok(report)
}

/// The `user_id` of a row, or an error when the row has none.
fn user_id_of(row: &Value) -> Result<&str, String> {
    row.get("user_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "a user_settings row has no user_id".to_string())
}

/// A database failure, described by its PostgREST code only (the message can echo data).
fn db_error(step: &str, err: &DbError) -> String {
    format!(
        "database {step} failed ({})",
        err.code.as_deref().unwrap_or("no code")
    )
}
