//! Tauri commands for the one-time import of the old Electron PGlite database into the native database.
//!
//! The frontend reads the old tables and sends each one here in batches, then finishes the import. The
//! owner session in `local_pg::host` does the writes; `import_finish` writes the marker last.

use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde::Serialize;
use specta::Type;

use crate::commands::{Json, LocalDb, ShellError, json_params};
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
    /// Rows written by this call. One batch, so it fits a JS number.
    #[specta(type = u32)]
    pub inserted: u64,
    /// Rows already present and left alone.
    #[specta(type = u32)]
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

/// Imports one batch of rows into `table`. `last` marks the table's final batch; only then is the
/// table recorded as done, so a big table can arrive in several calls.
#[tauri::command]
#[specta::specta]
pub async fn old_db_import_table(
    db: tauri::State<'_, LocalDb>,
    table: String,
    rows: Vec<Json>,
    last: bool,
) -> Result<ImportReport, ShellError> {
    let rows = json_params(rows)?;
    db.import_table(&table, &rows, last)
        .await
        .map(ImportReport::from)
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
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    db.import_finish(&tables, &data.join(IMPORTED_MARKER)).await
}

/// Whether an old database is waiting to be imported: one is found and no import has finished.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "tauri passes the handle by value"
)]
pub fn old_db_status(app: tauri::AppHandle) -> Result<bool, ShellError> {
    use tauri::Manager;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    Ok(pending(&data))
}

/// Bytes per tar part. One base64 string of the whole tar can pass V8's string limit (~512 MiB)
/// and crash the page, so the tar crosses the bridge in parts this size.
const TAR_PART_BYTES: usize = 16 << 20;

/// The tar built by part 0, kept until its last part is read.
static TAR: Mutex<Option<Arc<Vec<u8>>>> = Mutex::new(None);

/// One part of the old database tar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TarPart {
    /// This part's bytes, base64.
    pub data: String,
    /// How many parts the tar has.
    pub parts: u32,
}

/// Part `index` of the old PGlite dir as a tar, for PGlite's `loadDataDir`. Part 0 builds the tar
/// in memory and keeps it; the last part frees it. Read-only: the old dir is never written.
#[tauri::command]
#[specta::specta]
pub async fn old_db_tar_part(app: tauri::AppHandle, index: u32) -> Result<TarPart, ShellError> {
    let tar = if index == 0 {
        let tar = Arc::new(build_tar(&app).await?);
        *lock_tar() = Some(Arc::clone(&tar));
        tar
    } else {
        lock_tar().clone().ok_or_else(|| {
            ShellError::from("the old database tar is gone; start the import again".to_string())
        })?
    };
    let parts = part_count(tar.len(), TAR_PART_BYTES);
    let Some(bytes) = tar_part(&tar, index, TAR_PART_BYTES) else {
        return Err(ShellError::from(format!(
            "tar part {index} is out of range ({parts} parts)"
        )));
    };
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    if index + 1 >= parts {
        *lock_tar() = None;
    }
    Ok(TarPart { data, parts })
}

fn lock_tar() -> std::sync::MutexGuard<'static, Option<Arc<Vec<u8>>>> {
    TAR.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Parts needed for `len` bytes; an empty tar still has one (empty) part.
fn part_count(len: usize, size: usize) -> u32 {
    u32::try_from(len.div_ceil(size).max(1)).unwrap_or(u32::MAX)
}

/// The bytes of part `index`, or `None` past the end.
fn tar_part(tar: &[u8], index: u32, size: usize) -> Option<&[u8]> {
    if index >= part_count(tar.len(), size) {
        return None;
    }
    let start = usize::try_from(index).ok()?.checked_mul(size)?;
    Some(&tar[start..tar.len().min(start + size)])
}

/// Builds the old database tar in memory.
async fn build_tar(app: &tauri::AppHandle) -> Result<Vec<u8>, ShellError> {
    use tauri::Manager;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| ShellError::from(e.to_string()))?;
    let dir = match migrate::old_db_state(&data) {
        OldDb::Found(dir) => dir,
        OldDb::WorkspaceMissing(root) => {
            return Err(ShellError::from(format!(
                "the workspace folder {} is missing; reconnect it to import your data",
                root.display()
            )));
        }
        OldDb::None => {
            return Err(ShellError::from(
                "there is no old local database to import".to_string(),
            ));
        }
    };
    tokio::task::spawn_blocking(move || old_db::read_old_db(&dir))
        .await
        .map_err(|e| ShellError::from(e.to_string()))?
        .map_err(|e| ShellError::from(e.to_string()))
}

/// True while an old database is found under `data` and the import marker is not there yet.
#[must_use]
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
        std::fs::write(old.join("PG_VERSION"), "18\n").unwrap();
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
        assert!(db.import_table("notes", &[], true).await.is_err());
        assert!(
            db.import_finish(&["notes".to_string()], &dir.join(IMPORTED_MARKER))
                .await
                .is_err()
        );
        assert!(!dir.join(IMPORTED_MARKER).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tar_parts_cover_the_tar_in_order_and_stop_at_the_end() {
        // Guards: a lost or repeated byte at a part edge, which corrupts the old database.
        let tar: Vec<u8> = (0..=255u8).cycle().take(10).collect();
        assert_eq!(part_count(10, 4), 3);
        let joined: Vec<u8> = (0..3)
            .flat_map(|i| tar_part(&tar, i, 4).unwrap().to_vec())
            .collect();
        assert_eq!(joined, tar);
        assert_eq!(tar_part(&tar, 2, 4).unwrap().len(), 2);
        assert!(tar_part(&tar, 3, 4).is_none());
        assert_eq!(part_count(8, 4), 2, "an exact fit adds no empty part");
        assert_eq!(part_count(0, 4), 1);
        assert_eq!(tar_part(&[], 0, 4), Some(&[][..]));
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
