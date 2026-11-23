//! Tauri commands for the 0.9.7 migration: `migrate_097_status`, `migrate_097_counts`,
//! `migrate_097_read` and `migrate_097_remove_old`. The rules live in `status`, `counts` and `remove`; these only
//! gather the paths, the clock and the database handle.

use std::path::PathBuf;
use std::time::SystemTime;

use serde::Serialize;
use tauri::Manager;

use crate::commands::{LocalDb, ShellError};
use crate::migrate_097::counts::{RowCounts, counts_sql, parse_counts};
use crate::migrate_097::remove::{record_verified_export, remove_old_data};
use crate::migrate_097::status::{MigrationStatus, migration_status};

/// The app's local cluster root (the dir "remove old data" deletes).
pub(crate) fn pg_root(app: &tauri::AppHandle) -> Result<PathBuf, ShellError> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    Ok(crate::native_root(&data))
}

/// This machine's id (`device-id` in app data), created on first use.
pub(crate) fn device_id(app: &tauri::AppHandle) -> Result<String, ShellError> {
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

/// What `migrate_097_backup` made: this device's id and the dump to keep.
#[derive(Debug, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationBackup {
    pub device_id: String,
    pub dump_path: String,
}

/// Dumps the local database before the export, changed or not, and keeps a copy as
/// `<folder>/.weaveforge/migration-0.9.7/pre-migration-<stamp>.dump`. The rotation in
/// `local-db-backups` prunes its own `local-pg-*` files and is deleted with the old data; the
/// migration copy is in neither, so the dump `report.json` names outlives both. Never overwrites a
/// backup; any failure is an error, and the web gate then marks nothing.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_backup(
    app: tauri::AppHandle,
    db: tauri::State<'_, LocalDb>,
    folder: String,
) -> Result<MigrationBackup, ShellError> {
    let device = device_id(&app)?;
    let written = db.backup_now(SystemTime::now()).await?;
    let source = written
        .first()
        .ok_or_else(|| ShellError::from("backup wrote no file".to_owned()))?;
    let folder = PathBuf::from(folder);
    let kept = keep_migration_copy(&folder, &device, source).map_err(ShellError::from)?;
    Ok(MigrationBackup {
        device_id: device,
        dump_path: folder
            .join(crate::migrate_097::remove::MIGRATION_DIR)
            .join(kept.dump)
            .to_string_lossy()
            .into_owned(),
    })
}

/// Copies the rotation dump `source` (`local-pg-<stamp>.dump`) into the migration folder under
/// the same stamp, through `write_backup` (never overwrites, cleans up a failed copy).
pub fn keep_migration_copy(
    folder: &std::path::Path,
    device: &str,
    source: &std::path::Path,
) -> Result<crate::migrate_097::backup::BackupOut, String> {
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let stamp = name
        .strip_prefix("local-pg-")
        .and_then(|n| n.strip_suffix(".dump"))
        .ok_or_else(|| format!("refused: {name:?} is not a rotation dump"))?;
    crate::migrate_097::backup::write_backup(folder, device, stamp, &mut |path| {
        std::fs::copy(source, path)
            .map(|_| ())
            .map_err(|e| format!("cannot copy the backup: {e}"))
    })
}

/// One page of exporter `kind`, read-only. `after` is the last key read (one value per key column);
/// `limit` is clamped to 1000. Unknown kinds and `ink` are refused.
#[tauri::command]
#[specta::specta]
pub async fn migrate_097_read(
    db: tauri::State<'_, LocalDb>,
    kind: String,
    after: Option<Vec<serde_json::Value>>,
    limit: u32,
) -> Result<Vec<serde_json::Value>, ShellError> {
    db.read_page(&kind, after.as_deref(), limit).await
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
        let mut stop = || crate::stop_postgres(&stop_app, false);
        let removed = remove_old_data(&folder, &root, &now, &device, &mut secrets, &mut stop);
        // The lock covers the whole removal; it is dropped only once the cluster is gone.
        if removed.is_ok() {
            crate::release_db_lock(&stop_app)?;
        }
        removed
    })
    .await
    .map_err(|e| ShellError::from(e.to_string()))?
    .map_err(ShellError::from)
}

/// Records that `folder` holds this device's verified export, so removal can check the folder. The
/// web export calls it after its verify passes; the gate lives in `record_verified_export`.
#[tauri::command]
#[specta::specta]
pub async fn mark_exported_097(app: tauri::AppHandle, folder: String) -> Result<(), ShellError> {
    let root = pg_root(&app)?;
    let device = device_id(&app)?;
    record_verified_export(&root, &PathBuf::from(folder), &device).map_err(ShellError::from)
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
