//! Vault file commands for the page: read, write, list, stat and remove inside the chosen folder.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use tauri::Manager as _;
use wf_core::settings::workspace_settings::{SETTINGS_PATH, WorkspaceSettings};

use crate::commands::ShellError;
use crate::prefs::Prefs;
use crate::secrets::Secrets;
use crate::vault::{VaultEntry, VaultRoot, VaultSession, VaultState};
use crate::vault_choice::{
    Choice, adopt_choice, default_workspace_folder, forget_choice, missing_remembered,
    retry_remembered, setup_needed,
};
use crate::vault_watcher::WatchSlot;

/// Said when the bytes from the page are not valid base64; nothing is written.
pub const BAD_BYTES: &str = "Those bytes could not be read.";
/// Said when the Skip folder cannot be created.
pub const NOT_CREATED: &str = "WeaveForge could not create that folder.";
/// Said when a folder dialog is already open; the second pick is refused, not read as a cancel.
pub const PICK_BUSY: &str = "A folder dialog is already open. Finish or close it first.";
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
    secrets: tauri::State<'_, Secrets>,
) -> Result<Option<VaultRoot>, ShellError> {
    // Scoping here also covers a folder restored at launch, which never passes through a pick.
    let vault = state.inner().clone();
    let secrets = secrets.inner().clone();
    let root = tokio::task::spawn_blocking(move || {
        let session = vault.lock();
        if let Err(warning) = scope_secrets_to(&session, &secrets) {
            eprintln!("[vault] {warning}");
        }
        session.root()
    })
    .await
    .ok()
    .flatten();
    Ok(root)
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
    secrets: tauri::State<'_, Secrets>,
) -> Result<Choice, ShellError> {
    // The dialog is modal; this also refuses a second pick that slips in while one is open.
    let Some(_choosing) = Choosing::start() else {
        return Err(ShellError::from(PICK_BUSY.to_owned()));
    };
    let picked = pick_folder(&app, &window).await;
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    let watch = watch.inner().clone();
    let secrets = secrets.inner().clone();
    let sink = crate::change_sink(&app);
    let choice = tokio::task::spawn_blocking(move || {
        adopt_choice(&vault, &prefs, &watch, picked.as_deref(), sink)
            .map(|choice| scoped(choice, &vault, &secrets))
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
    .map_err(ShellError::from)?;
    log_warnings(&app, &choice);
    Ok(choice)
}

/// Keeps a pick's warnings in the app log as well as showing them on the page.
fn log_warnings(app: &tauri::AppHandle, choice: &Choice) {
    let path = choice.root.as_ref().map_or("", |root| root.path.as_str());
    for warning in &choice.warnings {
        crate::log_vault_warning(app, warning, path);
    }
}

/// Said when the folder's settings file cannot be read or written; its saved tokens are not used.
pub const SETTINGS_REFUSED: &str =
    "WeaveForge could not read this folder's settings file, so its saved tokens are not used.";

/// Scopes the keychain tokens to the open folder, using its workspace id from the settings file.
/// Any failure closes the scope first, so an earlier folder's tokens never serve this one.
///
/// # Errors
/// The reason the folder's id could not be read or stamped, or the keychain refused the id.
fn scope_secrets_to(session: &VaultSession, secrets: &Secrets) -> Result<(), String> {
    secrets
        .set_open_workspace(None)
        .map_err(|error| error.to_string())?;
    if session.root().is_none() {
        return Ok(());
    }
    let id = stamp_workspace_id(session)?;
    secrets
        .set_open_workspace(Some(&id))
        .map_err(|error| error.to_string())
}

/// The open folder's workspace id. A folder without one gets a random id, written once into
/// `.weaveforge/settings.json`; a stored id is kept as it is.
fn stamp_workspace_id(session: &VaultSession) -> Result<String, String> {
    let mut settings = match session.read_text(SETTINGS_PATH)? {
        None => WorkspaceSettings::new_folder(),
        Some(text) => WorkspaceSettings::parse(&text).map_err(|_| SETTINGS_REFUSED.to_owned())?,
    };
    let fresh = random_uuid().map_err(|_| SETTINGS_REFUSED.to_owned())?;
    if settings.ensure_workspace_id(&fresh) {
        let text = settings
            .to_text()
            .map_err(|_| SETTINGS_REFUSED.to_owned())?;
        session.write_text(SETTINGS_PATH, &text)?;
    }
    settings
        .tier
        .workspace_id
        .ok_or_else(|| SETTINGS_REFUSED.to_owned())
}

/// Runs the scope on a choice's folder and turns a failure into a warning on that choice.
/// Call it on the blocking thread that holds the choice's session work.
fn scoped(mut choice: Choice, vault: &VaultState, secrets: &Secrets) -> Choice {
    let session = vault.lock();
    if let Err(warning) = scope_secrets_to(&session, secrets) {
        choice.warnings.push(warning);
    }
    choice
}

/// A random version-4 UUID as text. A copy of the helper in `local_http::mcp_suggest`, which is private there.
fn random_uuid() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|err| err.to_string())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

/// The remembered folder while none is in use, so the page can say it is not available.
///
/// # Errors
/// Never; a `Result` for the command shape.
#[tauri::command]
#[specta::specta]
pub async fn vault_missing(
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
) -> Result<Option<String>, ShellError> {
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    tokio::task::spawn_blocking(move || missing_remembered(&vault, &prefs))
        .await
        .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))
}

/// Tries the remembered folder again, after a drive is plugged back in.
///
/// # Errors
/// The reason the folder still cannot hold a workspace; nothing changes.
#[tauri::command]
#[specta::specta]
pub async fn vault_retry(
    app: tauri::AppHandle,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    watch: tauri::State<'_, WatchSlot>,
    secrets: tauri::State<'_, Secrets>,
) -> Result<Choice, ShellError> {
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    let watch = watch.inner().clone();
    let secrets = secrets.inner().clone();
    let sink = crate::change_sink(&app);
    let choice = tokio::task::spawn_blocking(move || {
        retry_remembered(&vault, &prefs, &watch, sink)
            .map(|choice| scoped(choice, &vault, &secrets))
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
    .map_err(ShellError::from)?;
    log_warnings(&app, &choice);
    Ok(choice)
}

/// Disconnects the workspace folder: no longer used, watched or remembered. The files stay.
///
/// # Errors
/// Only when the blocking task fails.
#[tauri::command]
#[specta::specta]
pub async fn vault_forget(
    app: tauri::AppHandle,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    watch: tauri::State<'_, WatchSlot>,
    secrets: tauri::State<'_, Secrets>,
) -> Result<Choice, ShellError> {
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    let watch = watch.inner().clone();
    let secrets = secrets.inner().clone();
    // No folder is left open, so the scope closes.
    let choice = tokio::task::spawn_blocking(move || {
        scoped(forget_choice(&vault, &prefs, &watch), &vault, &secrets)
    })
    .await
    .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))?;
    log_warnings(&app, &choice);
    Ok(choice)
}

/// What the first-open question needs: whether to ask, and where Skip puts the workspace.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSetup {
    /// Ask the reader where the workspace lives.
    pub needed: bool,
    /// The folder Skip uses; `None` when the Documents folder is unknown.
    pub default_folder: Option<String>,
}

/// Said when the reader's Documents folder cannot be found, so Skip has nowhere to go.
pub const NO_DOCUMENTS: &str =
    "WeaveForge could not find your Documents folder. Pick a folder instead.";

/// Whether the first-open question is due, and the folder Skip would use.
///
/// # Errors
/// Never; a `Result` for the command shape.
#[tauri::command]
#[specta::specta]
pub async fn workspace_setup(
    app: tauri::AppHandle,
    prefs: tauri::State<'_, Prefs>,
) -> Result<WorkspaceSetup, ShellError> {
    let prefs = prefs.inner().clone();
    let needed = tokio::task::spawn_blocking(move || setup_needed(&prefs))
        .await
        .map_err(|_| ShellError::from(TASK_FAILED.to_owned()))?;
    let default_folder = app.path().document_dir().ok().map(|documents| {
        default_workspace_folder(&documents)
            .to_string_lossy()
            .into_owned()
    });
    Ok(WorkspaceSetup {
        needed,
        default_folder,
    })
}

/// Creates the folder Skip uses. The io cause is logged with the path; the reader gets `NOT_CREATED`.
///
/// # Errors
/// `NOT_CREATED` when the folder cannot be created.
pub fn create_skip_folder(target: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| {
        eprintln!("[vault] could not create {}: {error}", target.display());
        NOT_CREATED.to_owned()
    })
}

/// Skip on the first-open question: the workspace goes into `WeaveForge` in the reader's Documents
/// folder, created if missing, through the same checks as a pick.
///
/// # Errors
/// The reason that folder cannot hold a workspace; nothing changes.
#[tauri::command]
#[specta::specta]
pub async fn workspace_skip(
    app: tauri::AppHandle,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    watch: tauri::State<'_, WatchSlot>,
    secrets: tauri::State<'_, Secrets>,
) -> Result<Choice, ShellError> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|_| ShellError::from(NO_DOCUMENTS.to_owned()))?;
    let target = default_workspace_folder(&documents);
    let vault = vault.inner().clone();
    let prefs = prefs.inner().clone();
    let watch = watch.inner().clone();
    let secrets = secrets.inner().clone();
    let sink = crate::change_sink(&app);
    let choice = tokio::task::spawn_blocking(move || {
        create_skip_folder(&target)
            .and_then(|()| adopt_choice(&vault, &prefs, &watch, Some(&target), sink))
            .map(|choice| scoped(choice, &vault, &secrets))
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
    .map_err(ShellError::from)?;
    log_warnings(&app, &choice);
    Ok(choice)
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
#[cfg(desktop)]
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

/// Phones have no folder picker: the workspace is the app's own store there (phase 4 design).
#[cfg(mobile)]
async fn pick_folder(
    _app: &tauri::AppHandle,
    _window: &tauri::WebviewWindow,
) -> Option<std::path::PathBuf> {
    None
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
    // Noted before writing, so the folder watch can never see the write first, and under the
    // session lock, so a folder move cannot slip between the note and the write.
    let watch = watch.inner().clone();
    blocking(state.inner(), move |session| {
        watch.note_self_write(&path, contents.as_bytes());
        session.write_text(&path, &contents)
    })
    .await
    .map_err(ShellError::from)
}

/// Writes a text file only if it still says `expected` (`None` = still
/// missing); `false` = it changed since it was read, and nothing was written.
///
/// # Errors
/// No folder chosen, a refused path, or contents over the size cap.
#[tauri::command]
#[specta::specta]
pub async fn vault_write_if(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    path: String,
    contents: String,
    expected: Option<String>,
) -> Result<bool, ShellError> {
    let watch = watch.inner().clone();
    blocking(state.inner(), move |session| {
        watch.note_self_write(&path, contents.as_bytes());
        session.write_text_if(&path, &contents, expected.as_deref())
    })
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
    let watch = watch.inner().clone();
    blocking(state.inner(), move |session| {
        watch.note_self_write(&path, &bytes);
        session.write_bytes(&path, &bytes)
    })
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
    let watch = watch.inner().clone();
    blocking(state.inner(), move |session| {
        watch.note_self_remove(&path);
        session.remove(&path)
    })
    .await
    .map_err(ShellError::from)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use keyring_core::CredentialStore;

    use super::scope_secrets_to;
    use super::{SETTINGS_PATH, SETTINGS_REFUSED, Secrets, VaultSession, WorkspaceSettings};
    use crate::secrets::SecretError;

    const SERVICE: &str = "org.weaveforge.cmdvault-test";
    const TOKEN: &str = "git-sync-token";

    fn store() -> Arc<CredentialStore> {
        keyring_core::mock::Store::new().expect("mock store")
    }

    fn secrets(store: &Arc<CredentialStore>) -> Secrets {
        Secrets::new(Some(Arc::clone(store)), SERVICE)
    }

    /// A clean folder under the temp dir, unique to this test.
    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-cmdvault-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("folder");
        dir
    }

    /// Opens `dir` the way the shell does: adopt the folder, then scope the keychain to it.
    fn open(session: &mut VaultSession, secrets: &Secrets, dir: &Path) -> Result<(), String> {
        if session.adopt(Some(dir))?.is_none() {
            return Err("folder not adopted".to_owned());
        }
        scope_secrets_to(session, secrets)
    }

    fn stored_id(session: &VaultSession) -> Option<String> {
        let text = session
            .read_text(SETTINGS_PATH)
            .expect("read settings")
            .expect("settings file");
        WorkspaceSettings::parse(&text)
            .expect("parse settings")
            .tier
            .workspace_id
    }

    #[test]
    fn two_folders_keep_their_own_tokens_and_ids_across_reopen() {
        let store = store();
        let secrets = secrets(&store);
        let (a, b) = (folder("two-a"), folder("two-b"));
        let mut session = VaultSession::new();

        open(&mut session, &secrets, &a).expect("open a");
        let id_a = stored_id(&session).expect("id a");
        secrets.write(TOKEN, "token-a").expect("write a");

        open(&mut session, &secrets, &b).expect("open b");
        assert_ne!(stored_id(&session).as_deref(), Some(id_a.as_str()));
        assert_eq!(secrets.read(TOKEN).expect("read b"), None);
        secrets.write(TOKEN, "token-b").expect("write b");

        open(&mut session, &secrets, &a).expect("reopen a");
        assert_eq!(stored_id(&session), Some(id_a));
        assert_eq!(
            secrets.read(TOKEN).expect("read a"),
            Some("token-a".to_owned())
        );
    }

    #[test]
    fn a_first_open_stamps_a_version_four_id_and_later_opens_keep_it() {
        let store = store();
        let secrets = secrets(&store);
        let dir = folder("stamp");
        let mut session = VaultSession::new();

        open(&mut session, &secrets, &dir).expect("open");
        let id = stored_id(&session).expect("stamped id");
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'4');

        open(&mut session, &secrets, &dir).expect("reopen");
        assert_eq!(stored_id(&session), Some(id));
    }

    #[test]
    fn a_malformed_settings_file_is_refused_left_unchanged_and_keeps_the_scope_closed() {
        let store = store();
        let secrets = secrets(&store);
        let dir = folder("malformed");
        let settings = dir.join(SETTINGS_PATH);
        fs::create_dir_all(settings.parent().expect("parent")).expect("settings dir");
        fs::write(&settings, "{").expect("write malformed");
        let mut session = VaultSession::new();

        assert_eq!(
            open(&mut session, &secrets, &dir),
            Err(SETTINGS_REFUSED.to_owned())
        );
        assert_eq!(fs::read_to_string(&settings).expect("reread"), "{");
        assert_eq!(
            secrets.page_write(TOKEN, "x"),
            Err(SecretError::NoWorkspace)
        );
    }

    #[test]
    fn forgetting_the_folder_closes_its_token_scope() {
        let store = store();
        let secrets = secrets(&store);
        let dir = folder("forget");
        let mut session = VaultSession::new();

        open(&mut session, &secrets, &dir).expect("open");
        secrets.write(TOKEN, "token").expect("write");
        session.forget();
        scope_secrets_to(&session, &secrets).expect("scope after forget");
        assert_eq!(
            secrets.page_write(TOKEN, "x"),
            Err(SecretError::NoWorkspace)
        );
    }
}
