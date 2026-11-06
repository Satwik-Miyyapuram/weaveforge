//! Sizes and clears the app's own folders: saved artifacts, downloaded models and the log.
//!
//! The page names an area by id; it never sends a path, so it can only empty these folders.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::app_log::AppLog;
use crate::commands::ShellError;

/// What a folder holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Usage {
    /// Total size of its files.
    pub bytes: u64,
    /// How many files.
    pub files: u64,
}

/// The ids of the areas the page can size and clear, in the order it lists them.
/// `artifacts` and `models` are folders in app data; `log` is the log file.
pub const AREAS: [&str; 3] = ["artifacts", "models", "log"];

/// The known area id equal to `id`, or `None` for an unknown id.
#[must_use]
pub fn area(id: &str) -> Option<&'static str> {
    AREAS.iter().copied().find(|a| *a == id)
}

/// Sizes every file under `dir`, without following links. A missing or unreadable folder counts as empty.
#[must_use]
pub fn dir_usage(dir: &Path) -> Usage {
    let mut usage = Usage::default();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        let Ok(entries) = fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                usage.bytes = usage.bytes.saturating_add(size);
                usage.files = usage.files.saturating_add(1);
            }
        }
    }
    usage
}

/// Deletes everything inside `dir` and keeps `dir`. A link is removed, never followed.
///
/// # Errors
/// The first entry that could not be removed (for example a file in use); the rest are still tried.
pub fn clear_dir(dir: &Path) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let mut first_error = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let removed = match entry.file_type() {
            Ok(kind) if kind.is_dir() => fs::remove_dir_all(&path),
            // A link to a folder on Windows is removed with `remove_dir`.
            _ => fs::remove_file(&path).or_else(|_| fs::remove_dir(&path)),
        };
        if let Err(e) = removed {
            let _ = first_error.get_or_insert(e);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// One area's size, as the page shows it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StorageArea {
    /// `artifacts`, `models` or `log`.
    pub id: String,
    /// Total size in bytes.
    pub bytes: f64,
    /// How many files.
    pub files: f64,
    /// The most the folder may hold, when the app caps it (only `models`).
    pub limit: Option<f64>,
}

fn folder(app: &tauri::AppHandle, id: &str) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|data| data.join(id))
}

#[allow(clippy::cast_precision_loss)]
fn shown(id: &str, usage: Usage) -> StorageArea {
    StorageArea {
        id: id.to_owned(),
        bytes: usage.bytes as f64,
        files: usage.files as f64,
        limit: (id == "models").then_some(crate::model_cache::MAX_FOLDER_BYTES as f64),
    }
}

fn log_usage(log: &AppLog) -> Usage {
    fs::metadata(log.path()).map_or_else(
        |_| Usage::default(),
        |m| Usage {
            bytes: m.len(),
            files: 1,
        },
    )
}

/// How much space each of the app's folders takes on this computer.
///
/// # Errors
/// Never in practice; the `Err` arm is kept for the Tauri wiring.
#[tauri::command]
#[specta::specta]
pub async fn app_storage_usage(
    app: tauri::AppHandle,
    log: tauri::State<'_, AppLog>,
) -> Result<Vec<StorageArea>, ShellError> {
    let areas = AREAS
        .into_iter()
        .map(|id| match id {
            "log" => shown(id, log_usage(log.inner())),
            id => shown(
                id,
                folder(&app, id).map(|d| dir_usage(&d)).unwrap_or_default(),
            ),
        })
        .collect();
    Ok(areas)
}

/// Empties one of the app's folders, named by id.
///
/// # Errors
/// An unknown id, or files that could not be deleted (often because they are in use).
#[tauri::command]
#[specta::specta]
pub async fn app_storage_clear(
    app: tauri::AppHandle,
    log: tauri::State<'_, AppLog>,
    id: String,
) -> Result<(), ShellError> {
    let Some(area) = area(&id) else {
        return Err(ShellError {
            message: "That is not a folder this app can clear.".to_owned(),
        });
    };
    let done = match area {
        "log" => log.clear(),
        id => folder(&app, id).map_or(Ok(()), |d| clear_dir(&d)),
    };
    done.map_err(|e| {
        log.record(
            crate::app_log::LogLevel::Warn,
            "storage",
            &format!("Could not clear {id}"),
            Some(&e.to_string()),
        );
        ShellError {
            message: "Some files could not be deleted. They may be in use; close what uses them and try again.".to_owned(),
        }
    })
}

/// Removes the files an experiment saved on this computer, once the experiment is deleted.
#[tauri::command]
#[specta::specta]
pub async fn local_artifacts_delete(
    app: tauri::AppHandle,
    experiment_id: String,
) -> Result<(), ShellError> {
    let Some(root) = folder(&app, "artifacts") else {
        return Ok(());
    };
    crate::local_artifacts::delete_local_artifacts(&root, &experiment_id)
        .map_err(|message| ShellError { message })
}
