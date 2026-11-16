//! Tauri commands for the one-time import of the old Electron PGlite database into the native database.
//!
//! The frontend reads the old tables and sends each one here in batches, then finishes the import. The
//! owner session in `local_pg::host` does the writes; `import_finish` writes the marker last.

use std::path::Path;

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::commands::{LocalDb, ShellError};
use crate::local_pg::import::TableReport;
use crate::migrate::{self, OldDb};
use crate::old_db;

/// Marker in the native data dir. Written last, once every old table is in the native database.
pub const IMPORTED_MARKER: &str = "local-pg.imported";

/// What one table's import call did, as the frontend sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// The table name.
    pub table: String,
    /// Rows written by this call.
    pub inserted: u64,
    /// Rows already present and left alone.
    pub skipped: u64,
    /// Whether an earlier run already finished this table.
    pub already_done: bool,
}

impl From<TableReport> for ImportReport {
    fn from(report: TableReport) -> Self {
        Self {
            table: report.table,
            inserted: report.inserted,
            skipped: report.skipped,
            already_done: report.already_done,
        }
    }
}

/// Imports one batch of rows into `table`.
#[tauri::command]
#[specta::specta]
pub async fn old_db_import_table(
    db: tauri::State<'_, LocalDb>,
    table: String,
    rows: Vec<Value>,
) -> Result<ImportReport, ShellError> {
    db.import_table(&table, &rows).await.map(ImportReport::from)
}

/// Writes the import marker once every table in `tables` is done.
#[tauri::command]
#[specta::specta]
pub async fn old_db_import_finish(
    app: tauri::AppHandle,
    db: tauri::State<'_, LocalDb>,
    tables: Vec<String>,
) -> Result<(), ShellError> {
    use tauri::Manager;
    let data = app.path().app_data_dir().map_err(|e| ShellError::from(e.to_string()))?;
    db.import_finish(&tables, &data.join(IMPORTED_MARKER)).await
}

/// Whether an old database is waiting to be imported: one is found and no import has finished.
#[tauri::command]
#[specta::specta]
pub fn old_db_status(app: tauri::AppHandle) -> Result<bool, ShellError> {
    use tauri::Manager;
    let data = app.path().app_data_dir().map_err(|e| ShellError::from(e.to_string()))?;
    Ok(pending(&data))
}

/// The old PGlite dir as a base64 tar, for PGlite's `loadDataDir`. Read-only: the old dir is
/// never written, and the tar is built in memory.
#[tauri::command]
#[specta::specta]
pub async fn old_db_tar(app: tauri::AppHandle) -> Result<String, ShellError> {
    use tauri::Manager;
    let data = app.path().app_data_dir().map_err(|e| ShellError::from(e.to_string()))?;
    let dir = match migrate::old_db_state(&data) {
        OldDb::Found(dir) => dir,
        OldDb::WorkspaceMissing(root) => {
            return Err(ShellError::from(format!(
                "the workspace folder {} is missing; reconnect it to import your data",
                root.display()
            )));
        }
        OldDb::None => return Err(ShellError::from("there is no old local database to import".to_string())),
    };
    let bytes = tokio::task::spawn_blocking(move || old_db::read_old_db(&dir))
        .await
        .map_err(|e| ShellError::from(e.to_string()))?
        .map_err(|e| ShellError::from(e.to_string()))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// True while an old database is found under `data` and the import marker is not there yet.
pub fn pending(data: &Path) -> bool {
    matches!(migrate::old_db_state(data), OldDb::Found(_)) && !data.join(IMPORTED_MARKER).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_is_pending_only_while_old_db_exists_and_marker_is_absent() {
        let data = std::env::temp_dir().join(format!("wf-import-pending-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        std::fs::create_dir_all(&data).unwrap();
        assert!(!pending(&data), "no old db means nothing pending");
        let old = data.join("local-db");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("PG_VERSION"), "17\n").unwrap();
        assert!(pending(&data));
        std::fs::write(data.join(IMPORTED_MARKER), "").unwrap();
        assert!(!pending(&data), "the marker means the import finished");
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn import_commands_fail_when_the_native_db_is_down() {
        let dir = std::env::temp_dir().join(format!("wf-import-down-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = LocalDb::new(Err("no postgres".to_string()), "data".to_string());
        assert!(db.import_table("notes", &[]).await.is_err());
        assert!(db.import_finish(&["notes".to_string()], &dir.join(IMPORTED_MARKER)).await.is_err());
        assert!(!dir.join(IMPORTED_MARKER).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_report_copies_every_field() {
        let report = TableReport {
            table: "notes".into(),
            inserted: 3,
            skipped: 1,
            already_done: false,
        };
        assert_eq!(
            ImportReport::from(report),
            ImportReport {
                table: "notes".into(),
                inserted: 3,
                skipped: 1,
                already_done: false,
            }
        );
    }
}
