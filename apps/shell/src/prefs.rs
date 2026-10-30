//! Shell preferences in one JSON file (design: phase-2-desktop.md § 2.8).

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Map, Value};

use crate::commands::ShellError;

/// Every preference the shell keeps.
pub const PREFERENCE_NAMES: [&str; 9] = [
    "sync-target",
    "vault-root",
    "vault-git",
    "vault-git-remote",
    "local-api",
    "plan-widget",
    "plan-widget-bounds",
    "plan-widget-theme",
    "overleaf-links",
];

/// Preferences the page may write. The page has no preference read.
pub const PAGE_WRITABLE: [&str; 2] = ["vault-git", "vault-git-remote"];

/// A stored preference: text or a flag. `None` (TypeScript `null`) means not set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(untagged)]
pub enum PrefValue {
    /// Text, such as a server address.
    Text(String),
    /// A switch.
    Flag(bool),
}

/// Why a preference call was refused. The Display text is shown to the reader as-is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrefError {
    /// The name is not a known preference.
    #[error("That is not something this app remembers.")]
    UnknownName,
    /// The file exists but cannot be read.
    #[error("The preferences file could not be read just now, so nothing was changed.")]
    Unreadable,
    /// The file could not be written.
    #[error("The preferences file could not be saved just now, so nothing was changed.")]
    Unsaved,
}

/// The preferences file. Clones share one write lock.
#[derive(Clone)]
pub struct Prefs {
    file: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl Prefs {
    /// Preferences kept in `file` (created on first write, with its folder).
    #[must_use]
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// The stored value, or `None` when unset, unreadable, or of another shape.
    pub fn read(&self, name: &str) -> Result<Option<PrefValue>, PrefError> {
        check_name(name)?;
        let Ok(map) = load(&self.file) else {
            return Ok(None);
        };
        Ok(match map.get(name) {
            Some(Value::String(text)) => Some(PrefValue::Text(text.clone())),
            Some(Value::Bool(flag)) => Some(PrefValue::Flag(*flag)),
            _ => None,
        })
    }

    /// Stores `value` under `name`; `None` removes it. Other keys, known or not, are kept.
    pub fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), PrefError> {
        check_name(name)?;
        // One read-modify-write at a time, or two writes lose each other's key.
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        let mut map = load(&self.file).map_err(|_| PrefError::Unreadable)?;
        match value {
            Some(PrefValue::Text(text)) => {
                let _ = map.insert(name.to_owned(), Value::String(text));
            }
            Some(PrefValue::Flag(flag)) => {
                let _ = map.insert(name.to_owned(), Value::Bool(flag));
            }
            // Nothing to forget: leave the file as it is.
            None => {
                if map.remove(name).is_none() {
                    return Ok(());
                }
            }
        }
        save(&self.file, &map).map_err(|_| PrefError::Unsaved)
    }

    /// `write`, for the page: only names in `PAGE_WRITABLE`.
    pub fn page_write(&self, name: &str, value: Option<PrefValue>) -> Result<(), PrefError> {
        if !PAGE_WRITABLE.contains(&name) {
            return Err(PrefError::UnknownName);
        }
        self.write(name, value)
    }
}

fn check_name(name: &str) -> Result<(), PrefError> {
    if PREFERENCE_NAMES.contains(&name) {
        Ok(())
    } else {
        Err(PrefError::UnknownName)
    }
}

/// Everything on file. A missing or corrupt file is empty, as is one whose folder is a file
/// (Windows calls that not found, Linux not a directory); any other read error is returned.
fn load(file: &Path) -> io::Result<Map<String, Value>> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(e) if matches!(e.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {
            return Ok(Map::new());
        }
        Err(e) => return Err(e),
    };
    Ok(match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    })
}

/// Distinct per draft within this process, so two saves never share a draft name.
static NEXT_DRAFT: AtomicU64 = AtomicU64::new(0);

/// Written beside and renamed over, so a crash mid-save keeps the old file.
fn save(file: &Path, map: &Map<String, Value>) -> io::Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(map).map_err(io::Error::other)?;
    text.push('\n');
    let draft = file.with_file_name(format!(
        "preferences.json.{}.{}.tmp",
        std::process::id(),
        NEXT_DRAFT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = fs::write(&draft, text).and_then(|()| fs::rename(&draft, file));
    if result.is_err() {
        let _ = fs::remove_file(&draft);
    }
    result
}

/// Stores a preference the page may write; `null` removes it.
#[tauri::command]
#[specta::specta]
pub async fn preference_write(
    prefs: tauri::State<'_, Prefs>,
    name: String,
    value: Option<PrefValue>,
) -> Result<(), ShellError> {
    let prefs = prefs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || prefs.page_write(&name, value))
        .await
        .unwrap_or(Err(PrefError::Unsaved))
        .map_err(ShellError::from)
}

impl From<PrefError> for ShellError {
    fn from(error: PrefError) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}
