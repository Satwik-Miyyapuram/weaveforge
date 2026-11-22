//! The one-shot `seal-legacy-credentials` run: seals every `user_settings` row that still
//! holds plaintext legacy credentials. Re-running it finds nothing left to do.

use serde_json::Value;

use crate::config::Config;
use crate::credential_crypto::MISSING_KEY;
use crate::legacy_credentials::{legacy_secrets, seal_patch};
use crate::postgrest::{DbError, UserDb, eq};

/// Rows fetched per page.
const PAGE: usize = 200;

/// What a run did. Counts only: no value is ever reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// Rows that hold legacy plaintext and no envelope.
    pub found: usize,
    /// Rows written this run (always 0 on a dry run).
    pub converted: usize,
    /// Whether this run only counted.
    pub dry_run: bool,
}

/// Seals every legacy row, service-role, one row at a time.
///
/// Refuses before any database call when `key` (the credential key) is missing. With
/// `dry_run` it reads and counts but writes nothing. Each write is guarded by
/// `credentials_enc is null`, so a row sealed meanwhile is left alone.
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
            ("credentials_enc", "is.null".to_string()),
            (
                "or",
                "(zotero_api_key.not.is.null,semantic_scholar_key.not.is.null,integrations.not.is.null)"
                    .to_string(),
            ),
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
            let Some(secrets) = legacy_secrets(row) else {
                continue;
            };
            report.found += 1;
            if dry_run {
                continue;
            }
            let user = user_id_of(row)?;
            let patch = seal_patch(&secrets, key)?;
            let guard = [
                ("user_id", eq(user)),
                ("credentials_enc", "is.null".to_string()),
            ];
            db.update("user_settings", &guard, &patch)
                .await
                .map_err(|err| db_error("write", &err))?;
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
