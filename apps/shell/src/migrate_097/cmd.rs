//! Tauri commands for the 0.9.7 migration: `migrate_097_status`, `migrate_097_counts` and
//! `migrate_097_remove_old`. The rules live in `status`, `counts` and `remove`; these only
//! gather the paths, the clock and the database handle.

use std::path::PathBuf;
use std::time::SystemTime;

use tauri::Manager;

use crate::commands::{LocalDb, ShellError};
use crate::migrate_097::counts::{RowCounts, counts_sql, parse_counts};
use crate::migrate_097::remove::remove_old_data;
use crate::migrate_097::status::{MigrationStatus, migration_status};

/// The app's local cluster root (the dir "remove old data" deletes).
fn pg_root(app: &tauri::AppHandle) -> Result<PathBuf, ShellError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    Ok(crate::native_root(&data))
}

/// This machine's id (`device-id` in app data), created on first use.
fn device_id(app: &tauri::AppHandle) -> Result<String, ShellError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    crate::device_id::get_or_create(&data).map_err(|e| ShellError::from(e.to_string()))
}

/// Reads the migration state for `folder`. Never writes.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_status(
    app: tauri::AppHandle,
    folder: String,
) -> Result<MigrationStatus, ShellError> {
    let root = pg_root(&app)?;
    let device = device_id(&app)?;
    Ok(migration_status(&PathBuf::from(folder), &root, &device))
}

/// Row counts for every personal table, plus the CRDT tail past each snapshot.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_counts(db: tauri::State<'_, LocalDb>) -> Result<RowCounts, ShellError> {
    let rows = db.query(counts_sql(), Vec::new()).await?;
    let text = rows
        .first()
        .and_then(serde_json::Value::as_object)
        .and_then(|row| row.values().next())
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ShellError::from("row counts query returned no value".to_owned()))?;
    parse_counts(text).map_err(ShellError::from)
}

/// Deletes the local cluster after a verified migration. See `remove_old_data` for the gates.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_remove_old(
    app: tauri::AppHandle,
    db: tauri::State<'_, LocalDb>,
    folder: String,
) -> Result<(), ShellError> {
    let folder = PathBuf::from(folder);
    let root = pg_root(&app)?;
    let now = crate::vault::iso_utc(SystemTime::now());
    let device = device_id(&app)?;
    // The secrets gate needs `local_secrets` while Postgres is still up. Read it only for a
    // verified migration, because a `removing` resume runs with Postgres already down.
    let local_rows = if migration_status(&folder, &root, &device).state == "verified" {
        Some(count_local_secrets(&db).await?)
    } else {
        None
    };
    let stop_app = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut secrets = || {
            local_rows.ok_or_else(|| "refused: local_secrets count was not read".to_owned())
        };
        let mut stop = || -> Result<(), String> {
            crate::stop_local_db(&stop_app);
            Ok(())
        };
        remove_old_data(&folder, &root, &now, &device, &mut secrets, &mut stop)
    })
    .await
    .map_err(|e| ShellError::from(e.to_string()))?
    .map_err(ShellError::from)
}

async fn count_local_secrets(db: &LocalDb) -> Result<u64, ShellError> {
    let rows = db
        .query("select count(*)::text as n from local_secrets".to_owned(), Vec::new())
        .await?;
    rows.first()
        .map(|row| &row["n"])
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .ok_or_else(|| ShellError::from("local_secrets count unreadable".to_owned()))
}
