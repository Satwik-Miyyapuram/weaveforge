//! Vault file commands for the page: read, write, list, stat and remove inside the chosen folder.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::commands::ShellError;
use crate::vault::{VaultEntry, VaultRoot, VaultSession, VaultState};
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
    path: String,
) -> Result<(), ShellError> {
    remove(state.inner(), path).await.map_err(ShellError::from)
}
