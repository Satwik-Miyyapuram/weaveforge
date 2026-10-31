//! Vault file commands for the page: read, write, list, stat and remove inside the chosen folder.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::commands::ShellError;
use crate::prefs::Prefs;
use crate::vault::{VaultEntry, VaultRoot, VaultSession, VaultState};
use crate::vault_choice::adopt_choice;
use crate::vault_watcher::WatchSlot;

/// Said when the bytes from the page are not valid base64; nothing is written.
pub const BAD_BYTES: &str = "Those bytes could not be read.";
/// Said when the blocking task that ran a file operation panicked.
pub const TASK_FAILED: &str = "The folder could not be read.";

/// Runs `job` on the session in a blocking task, because file IO must not hold the async runtime.
async fn blocking<T, F>(state: &VaultState, job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&VaultSession) -> Result<T, String> + Send + 'static,
{
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        let session = state.lock();
        job(&session)
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
}

/// The chosen workspace folder, or `None` when none is chosen.
pub async fn root(state: &VaultState) -> Option<VaultRoot> {
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        let session = state.lock();
        session.root()
    })
    .await
    .ok()
    .flatten()
}

/// Text of a file in the chosen folder; `None` when the file is missing.
///
/// # Errors
/// No folder chosen, a refused path, or a file over the size cap.
pub async fn read(state: &VaultState, path: String) -> Result<Option<String>, String> {
    blocking(state, move |session| session.read_text(&path)).await
}

/// Writes text to a file in the chosen folder, creating its folders.
///
/// # Errors
/// No folder chosen, a refused path, or contents over the size cap.
pub async fn write(state: &VaultState, path: String, contents: String) -> Result<(), String> {
    blocking(state, move |session| session.write_text(&path, &contents)).await
}

/// Bytes of a file in the chosen folder as standard base64; `None` when the file is missing.
///
/// # Errors
/// No folder chosen, a refused path, or a file over the size cap.
pub async fn read_bytes(state: &VaultState, path: String) -> Result<Option<String>, String> {
    blocking(state, move |session| {
        let bytes = session.read_bytes(&path)?;
        Ok(bytes.map(|bytes| STANDARD.encode(bytes)))
    })
    .await
}

/// Writes bytes, given as standard base64, to a file in the chosen folder.
///
/// # Errors
/// Invalid base64 (nothing is written), no folder chosen, a refused path, or contents over the size cap.
pub async fn write_bytes(state: &VaultState, path: String, bytes: String) -> Result<(), String> {
    write_raw(state, path, decode_bytes(&bytes)?).await
}

/// Decodes standard base64 bytes from the page.
///
/// # Errors
/// `BAD_BYTES` when `bytes` is not valid base64.
pub fn decode_bytes(bytes: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(bytes).map_err(|_| BAD_BYTES.to_owned())
}

/// Writes raw bytes to a file in the chosen folder.
///
/// # Errors
/// No folder chosen, a refused path, or contents over the size cap.
pub async fn write_raw(state: &VaultState, path: String, bytes: Vec<u8>) -> Result<(), String> {
    blocking(state, move |session| session.write_bytes(&path, &bytes)).await
}

/// Entries directly inside `path`, or inside the chosen folder when `path` is `None`.
///
/// # Errors
/// No folder chosen, a refused path, or a folder that cannot be read.
pub async fn list(state: &VaultState, path: Option<String>) -> Result<Vec<VaultEntry>, String> {
    blocking(state, move |session| session.list(path.as_deref())).await
}

/// Metadata for one file or folder; `None` when it is missing.
///
/// # Errors
/// No folder chosen.
pub async fn stat(state: &VaultState, path: String) -> Result<Option<VaultEntry>, String> {
    blocking(state, move |session| session.stat(&path)).await
}

/// Removes one file; a missing file is not an error. Folders are never removed.
///
/// # Errors
/// No folder chosen, a refused path, or a folder.
pub async fn remove(state: &VaultState, path: String) -> Result<(), String> {
    blocking(state, move |session| session.remove(&path)).await
}

/// The chosen workspace folder, or nothing when none is chosen.
///
/// # Errors
/// Never; the answer is always `Ok`.
#[tauri::command]
#[specta::specta]
pub async fn vault_root(
    state: tauri::State<'_, VaultState>,
) -> Result<Option<VaultRoot>, ShellError> {
    Ok(root(state.inner()).await)
}

/// Asks the reader for a workspace folder in a native dialog and moves the workspace there.
///
/// Cancelling answers the current folder unchanged. The page never names a folder.
///
/// # Errors
/// The reason the picked folder cannot hold a workspace; nothing changes.
#[tauri::command]
#[specta::specta]
pub async fn vault_choose(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    watch: tauri::State<'_, WatchSlot>,
) -> Result<Option<VaultRoot>, ShellError> {
    // The dialog is modal; this also refuses a second pick that slips in while one is open.
    let Some(_choosing) = Choosing::start() else {
        return Ok(root(vault.inner()).await);
    };
    let picked = pick_folder(&app, &window).await;
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    let watch = watch.inner().clone();
    let sink = crate::change_sink(&app);
    let choice = tokio::task::spawn_blocking(move || {
        adopt_choice(&vault, &prefs, &watch, picked.as_deref(), sink)
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
    .map_err(ShellError::from)?;
    if let Some(root) = &choice.root {
        for warning in &choice.warnings {
            crate::log_vault_warning(&app, warning, &root.path);
        }
        crate::local_api::forward_vault_root(&app, Some(root)).await;
    }
    Ok(choice.root)
}

/// Set while a folder dialog is open.
static CHOOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Holds `CHOOSING` for one pick and releases it when dropped, even on an early return.
struct Choosing;

impl Choosing {
    /// `None` when another pick is already open.
    fn start() -> Option<Self> {
        use std::sync::atomic::Ordering;
        CHOOSING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for Choosing {
    fn drop(&mut self) {
        CHOOSING.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// The folder the reader picked, or `None` when the dialog was cancelled or the pick is not a local path.
async fn pick_folder(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<std::path::PathBuf> {
    use tauri_plugin_dialog::DialogExt as _;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a folder for your workspace")
        .set_parent(window)
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|picked| picked.into_path().ok())
}

/// Reads a text file in the chosen folder.
///
/// # Errors
/// No folder chosen, a refused path, or a file over the size cap.
#[tauri::command]
#[specta::specta]
pub async fn vault_read(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<Option<String>, ShellError> {
    read(state.inner(), path).await.map_err(ShellError::from)
}

/// Writes a text file in the chosen folder.
///
/// # Errors
/// No folder chosen, a refused path, or contents over the size cap.
#[tauri::command]
#[specta::specta]
pub async fn vault_write(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    path: String,
    contents: String,
) -> Result<(), ShellError> {
    // Noted before writing, so the folder watch can never see the write first.
    watch.note_self_write(&path, contents.as_bytes());
    write(state.inner(), path, contents)
        .await
        .map_err(ShellError::from)
}

/// Reads a binary file in the chosen folder as base64.
///
/// # Errors
/// No folder chosen, a refused path, or a file over the size cap.
#[tauri::command]
#[specta::specta]
pub async fn vault_read_bytes(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<Option<String>, ShellError> {
    read_bytes(state.inner(), path)
        .await
        .map_err(ShellError::from)
}

/// Writes a binary file in the chosen folder from base64.
///
/// # Errors
/// Invalid base64, no folder chosen, a refused path, or contents over the size cap.
#[tauri::command]
#[specta::specta]
pub async fn vault_write_bytes(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    path: String,
    bytes: String,
) -> Result<(), ShellError> {
    let bytes = decode_bytes(&bytes)?;
    watch.note_self_write(&path, &bytes);
    write_raw(state.inner(), path, bytes)
        .await
        .map_err(ShellError::from)
}

/// Lists a folder in the chosen folder; the root when `path` is absent.
///
/// # Errors
/// No folder chosen, a refused path, or a folder that cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn vault_list(
    state: tauri::State<'_, VaultState>,
    path: Option<String>,
) -> Result<Vec<VaultEntry>, ShellError> {
    list(state.inner(), path).await.map_err(ShellError::from)
}

/// Metadata for one file or folder in the chosen folder.
///
/// # Errors
/// No folder chosen.
#[tauri::command]
#[specta::specta]
pub async fn vault_stat(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<Option<VaultEntry>, ShellError> {
    stat(state.inner(), path).await.map_err(ShellError::from)
}

/// Removes one file in the chosen folder.
///
/// # Errors
/// No folder chosen, a refused path, or a folder.
#[tauri::command]
#[specta::specta]
pub async fn vault_remove(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    path: String,
) -> Result<(), ShellError> {
    watch.note_self_remove(&path);
    remove(state.inner(), path).await.map_err(ShellError::from)
}
