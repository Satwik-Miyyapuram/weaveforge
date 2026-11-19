//! Files-first commands (0.9.4 L0): checked writes, trash, rename, the per-device base store,
//! the in-memory file index, a pull that reports the paths it wrote, and file history.

use std::sync::{Arc, Mutex, PoisonError};

use tauri::Emitter as _;
use wf_core::index::{IndexEntry, IndexStore, scan::index_files};
use wf_core::sync::frontmatter::{FileKind, file_kind};
use wf_core::sync::git_policy::is_local_meta;
use wf_store::bases::BaseStore;
use wf_store::checked_write::WriteOutcome;
use wf_store::git::remote::{PullOutcome, RemoteConfig, pull_listing, redact_secret_for};
use wf_store::git::repo::FolderRepo;
use wf_store::vault::{EntryKind, Vault};

use crate::commands::ShellError;
use crate::git::{GIT_TIMEOUT, GitQueue};
use crate::prefs::Prefs;
use crate::secrets::Secrets;
use crate::vault::{MAX_BLOB_BYTES, MAX_TEXT_BYTES, NO_ROOT, VaultState, too_large};
use crate::vault_sync::{
    check_git_remote_url, current_root, file_log, git_reason, queued_reason, read_settings,
};
use crate::vault_watcher::WatchSlot;

/// The event that lists the workspace paths one `git_pull_now` wrote.
pub const PULL_BATCH_EVENT: &str = "pull-batch";
/// How many paths one `vault-changed` batch from `watcher_rescan` carries at most.
pub const RESCAN_BATCH: usize = 500;
/// Said when the blocking task that ran a file command panicked.
pub const TASK_FAILED: &str = "The folder could not be read.";

/// What a checked write did: `hash` when written, `changed` when the file moved on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteReply {
    /// Digest of the file on disk after the write; `None` when nothing was written.
    pub hash: Option<String>,
    /// Set when the file no longer matched `expected_hash`; nothing was written.
    pub changed: Option<ChangedFile>,
}

/// The file on disk no longer matched the expected digest.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// Digest of the file on disk now; empty when it is missing.
    pub disk_hash: String,
}

impl From<WriteOutcome> for FileWriteReply {
    fn from(outcome: WriteOutcome) -> Self {
        match outcome {
            WriteOutcome::Written { hash } => Self {
                hash: Some(hash),
                changed: None,
            },
            WriteOutcome::Changed { disk_hash } => Self {
                hash: None,
                changed: Some(ChangedFile { disk_hash }),
            },
        }
    }
}

/// Where a deleted file went.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashReply {
    /// Workspace path of the file under `.weaveforge/trash/`.
    pub trashed_to: String,
}

/// A stored base, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BaseReply {
    /// Canonical text.
    pub text: String,
    /// Digest of the canonical text.
    pub digest: String,
    /// Encoded Yjs state, when stored.
    pub yjs_state: Option<Vec<u8>>,
}

/// The digest `base_set` stored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DigestReply {
    /// Digest of the canonical text.
    pub digest: String,
}

/// One indexed file, as the page sees it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexItem {
    /// The entity id the file declares.
    pub id: String,
    /// Workspace path.
    pub path: String,
    /// Entity kind.
    pub kind: String,
    /// Project folder, if any.
    pub project_id: Option<String>,
    /// Title.
    pub title: String,
    /// Tags.
    pub tags: Vec<String>,
    /// Ids the body links to.
    pub links: Vec<String>,
    /// Declared `wf` format version, if any.
    pub wf: Option<u32>,
    /// True when the file must not be written.
    pub read_only: bool,
    /// True when another file shares this id.
    pub duplicate: bool,
    /// The id this file is a conflict copy of, if any.
    pub conflict_of: Option<String>,
    /// Digest of the canonical text.
    pub digest: String,
}

impl From<&IndexEntry> for IndexItem {
    fn from(entry: &IndexEntry) -> Self {
        Self {
            id: entry.id.clone(),
            path: entry.path.clone(),
            kind: entry.kind.clone(),
            project_id: entry.project_id.clone(),
            title: entry.title.clone(),
            tags: entry.tags.clone(),
            links: entry.links.clone(),
            wf: entry.wf.and_then(|wf| u32::try_from(wf).ok()),
            read_only: entry.read_only,
            duplicate: entry.duplicate,
            conflict_of: entry.conflict_of.clone(),
            digest: entry.digest.clone(),
        }
    }
}

/// What `git_pull_now` did.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullNowReply {
    /// True when remote changes came in.
    pub pulled: bool,
    /// The paths the pull wrote, sorted.
    pub paths: Vec<String>,
}

/// One commit that touched a file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileCommit {
    /// Full commit id.
    pub sha: String,
    /// Author time, ISO 8601.
    pub at: String,
}

/// A file's history, newest first.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileHistory {
    /// The commits.
    pub commits: Vec<FileCommit>,
}

/// How many `vault-changed` batches a rescan sent.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RescanReply {
    /// Batch count.
    pub batches: u32,
}

/// The in-memory file index, built on first use and dropped when files change.
#[derive(Clone, Default)]
pub struct IndexSlot(Arc<Mutex<Option<IndexStore>>>);

impl IndexSlot {
    /// Forgets the index; the next read rebuilds it from the files.
    pub fn invalidate(&self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    /// Runs `read` on the index, building it from `vault` first when needed.
    fn with<T>(&self, vault: &Vault, read: impl FnOnce(&IndexStore) -> T) -> T {
        let mut slot = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        let store = slot.get_or_insert_with(|| build_index(vault));
        read(store)
    }
}

/// True for files the index reads: notes, canvases and project relation tables.
#[must_use]
pub fn indexable(path: &str) -> bool {
    matches!(file_kind(path), FileKind::Markdown | FileKind::Canvas)
        || path.ends_with("/.weaveforge/relations.json")
}

/// Reads every indexable file of the workspace into a fresh index; this device's own
/// `.weaveforge/` files and files over the text cap are skipped.
#[must_use]
pub fn build_index(vault: &Vault) -> IndexStore {
    let files: Vec<(String, String)> = vault
        .walk("")
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry.kind == EntryKind::File && !is_local_meta(&entry.path))
        .filter(|entry| indexable(&entry.path))
        .filter_map(|entry| {
            let bytes = vault.read_file_max(&entry.path, MAX_TEXT_BYTES).ok()?;
            Some((entry.path, String::from_utf8(bytes).ok()?))
        })
        .collect();
    index_files(
        files
            .iter()
            .map(|(path, text)| (path.as_str(), text.as_str())),
    )
}

/// Runs `job` with the chosen folder's vault in a blocking task.
async fn on_vault<T, F>(state: &VaultState, job: F) -> Result<T, ShellError>
where
    T: Send + 'static,
    F: FnOnce(&Vault) -> Result<T, String> + Send + 'static,
{
    let state = state.clone();
    tokio::task::spawn_blocking(move || {
        let session = state.lock();
        job(session.vault()?)
    })
    .await
    .unwrap_or_else(|_| Err(TASK_FAILED.to_owned()))
    .map_err(ShellError::from)
}

/// Rejects contents over `cap` bytes.
fn check_len(len: usize, cap: u64) -> Result<(), String> {
    match u64::try_from(len) {
        Ok(size) if size <= cap => Ok(()),
        _ => Err(too_large(cap)),
    }
}

/// Writes a text file atomically if it still has digest `expected_hash` (`None` = always).
///
/// # Errors
/// No folder chosen, a refused path, contents over the size cap, or a filesystem failure.
#[tauri::command]
#[specta::specta]
pub async fn file_write(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    index: tauri::State<'_, IndexSlot>,
    path: String,
    contents: String,
    expected_hash: Option<String>,
) -> Result<FileWriteReply, ShellError> {
    let (watch, index) = (watch.inner().clone(), index.inner().clone());
    on_vault(state.inner(), move |vault| {
        check_len(contents.len(), MAX_TEXT_BYTES)?;
        wf_core::settings::secret_guard::check_config_write(&path, &contents)
            .map_err(|e| e.to_string())?;
        let text = wf_core::sync::frontmatter::canonical_text(&contents);
        watch.note_self_write(&path, text.as_bytes());
        let outcome = vault
            .write_text_checked(&path, &contents, expected_hash.as_deref())
            .map_err(|e| e.to_string())?;
        index.invalidate();
        Ok(FileWriteReply::from(outcome))
    })
    .await
}

/// Writes a binary file atomically if it still has digest `expected_hash` (`None` = always).
///
/// # Errors
/// No folder chosen, a refused path, bytes over the size cap, or a filesystem failure.
#[tauri::command]
#[specta::specta]
pub async fn file_write_bytes(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    path: String,
    bytes: Vec<u8>,
    expected_hash: Option<String>,
) -> Result<FileWriteReply, ShellError> {
    let watch = watch.inner().clone();
    on_vault(state.inner(), move |vault| {
        check_len(bytes.len(), MAX_BLOB_BYTES)?;
        wf_core::settings::secret_guard::check_config_bytes(&path, &bytes)
            .map_err(|e| e.to_string())?;
        watch.note_self_write(&path, &bytes);
        vault
            .write_bytes_checked(&path, &bytes, expected_hash.as_deref())
            .map(FileWriteReply::from)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Moves a file to `.weaveforge/trash/<day>/`.
///
/// # Errors
/// No folder chosen, a refused or missing path, or a filesystem failure.
#[tauri::command]
#[specta::specta]
pub async fn file_delete(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    index: tauri::State<'_, IndexSlot>,
    path: String,
) -> Result<TrashReply, ShellError> {
    let (watch, index) = (watch.inner().clone(), index.inner().clone());
    on_vault(state.inner(), move |vault| {
        watch.note_self_remove(&path);
        let trashed_to = vault.delete_to_trash(&path).map_err(|e| e.to_string())?;
        index.invalidate();
        Ok(TrashReply { trashed_to })
    })
    .await
}

/// Renames a file inside the workspace; an existing target is kept as a conflict copy.
///
/// # Errors
/// No folder chosen, a refused path, or a filesystem failure.
#[tauri::command]
#[specta::specta]
pub async fn file_rename(
    state: tauri::State<'_, VaultState>,
    watch: tauri::State<'_, WatchSlot>,
    index: tauri::State<'_, IndexSlot>,
    from: String,
    to: String,
) -> Result<bool, ShellError> {
    let (watch, index) = (watch.inner().clone(), index.inner().clone());
    on_vault(state.inner(), move |vault| {
        // A rename onto a config path is a write of the moved file there: check it first.
        if wf_core::settings::secret_guard::is_config_path(&to) {
            let bytes = vault.read_file(&from).map_err(|e| e.to_string())?;
            wf_core::settings::secret_guard::check_config_bytes(&to, &bytes)
                .map_err(|e| e.to_string())?;
        }
        watch.note_self_remove(&from);
        // The moved file is our write too. It is noted before the rename so the watcher cannot
        // report it as an external edit first. The conflict copy's name is only known after the
        // rename, so that one is noted right after it is made.
        if let Ok(bytes) = vault.read_file(&from) {
            watch.note_self_write(&to, &bytes);
        }
        let aside = vault
            .rename_checked(&from, &to)
            .map_err(|e| e.to_string())?;
        if let Some(copy) = aside.as_deref()
            && let Ok(bytes) = vault.read_file(copy)
        {
            watch.note_self_write(copy, &bytes);
        }
        index.invalidate();
        Ok(true)
    })
    .await
}

/// The stored base of `item_id`, if any.
///
/// # Errors
/// No folder chosen, or the base store cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn base_get(
    state: tauri::State<'_, VaultState>,
    item_id: String,
) -> Result<Option<BaseReply>, ShellError> {
    on_vault(state.inner(), move |vault| {
        let store = BaseStore::open(vault.root()).map_err(|e| e.to_string())?;
        let base = store.get(&item_id).map_err(|e| e.to_string())?;
        Ok(base.map(|base| BaseReply {
            text: base.text,
            digest: base.digest,
            yjs_state: base.yjs_state,
        }))
    })
    .await
}

/// Stores `text` (and a Yjs snapshot) as the base of `item_id`.
///
/// # Errors
/// No folder chosen, or the base store cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn base_set(
    state: tauri::State<'_, VaultState>,
    item_id: String,
    text: String,
    yjs_state: Option<Vec<u8>>,
) -> Result<DigestReply, ShellError> {
    on_vault(state.inner(), move |vault| {
        let store = BaseStore::open(vault.root()).map_err(|e| e.to_string())?;
        let digest = store
            .set(&item_id, &text, yjs_state.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(DigestReply { digest })
    })
    .await
}

/// The indexed file that declares `id`, if any.
///
/// # Errors
/// No folder chosen.
#[tauri::command]
#[specta::specta]
pub async fn index_get(
    state: tauri::State<'_, VaultState>,
    index: tauri::State<'_, IndexSlot>,
    id: String,
) -> Result<Option<IndexItem>, ShellError> {
    let index = index.inner().clone();
    on_vault(state.inner(), move |vault| {
        Ok(index.with(vault, |store| store.get(&id).map(IndexItem::from)))
    })
    .await
}

/// The indexed files of one kind, optionally in one project.
///
/// # Errors
/// No folder chosen.
#[tauri::command]
#[specta::specta]
pub async fn index_list(
    state: tauri::State<'_, VaultState>,
    index: tauri::State<'_, IndexSlot>,
    kind: String,
    project_id: Option<String>,
) -> Result<Vec<IndexItem>, ShellError> {
    let index = index.inner().clone();
    on_vault(state.inner(), move |vault| {
        Ok(index.with(vault, |store| {
            store
                .list(&kind, project_id.as_deref())
                .into_iter()
                .map(IndexItem::from)
                .collect()
        }))
    })
    .await
}

/// Rebuilds the index and re-reports every file under `scope` (`workspace` or `dir:<path>`)
/// as `vault-changed` batches; used after a `vault-watch-overflow`.
///
/// # Errors
/// No folder chosen, or a refused folder.
#[tauri::command]
#[specta::specta]
pub async fn watcher_rescan(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    index: tauri::State<'_, IndexSlot>,
    scope: String,
) -> Result<RescanReply, ShellError> {
    let index = index.inner().clone();
    let dir = scope.strip_prefix("dir:").unwrap_or("").to_owned();
    let paths = on_vault(state.inner(), move |vault| {
        index.invalidate();
        let entries = vault.walk(&dir).map_err(|e| e.to_string())?;
        Ok(entries
            .into_iter()
            .filter(|entry| entry.kind == EntryKind::File && !is_local_meta(&entry.path))
            .map(|entry| entry.path)
            .collect::<Vec<_>>())
    })
    .await?;
    let mut batches = 0_u32;
    for chunk in paths.chunks(RESCAN_BATCH) {
        let _ = app.emit(crate::VAULT_CHANGED_EVENT, chunk);
        batches = batches.saturating_add(1);
    }
    Ok(RescanReply { batches })
}

/// Pulls now and emits one `pull-batch` event listing the paths the pull wrote.
///
/// # Errors
/// No folder chosen, a refused remote URL, or git failed (token removed from the reason).
#[tauri::command]
#[specta::specta]
pub async fn git_pull_now(
    app: tauri::AppHandle,
    queue: tauri::State<'_, GitQueue>,
    vault: tauri::State<'_, VaultState>,
    prefs: tauri::State<'_, Prefs>,
    secrets: tauri::State<'_, Secrets>,
    index: tauri::State<'_, IndexSlot>,
) -> Result<PullNowReply, ShellError> {
    let stored = prefs.inner().clone();
    let settings = secrets
        .queued(move |s| Ok(read_settings(&stored, s)))
        .await
        .map_err(ShellError::from)?;
    let root = current_root(vault.inner())
        .await
        .ok_or_else(|| ShellError::from(NO_ROOT.to_owned()))?;
    if !settings.enabled {
        return Ok(PullNowReply {
            pulled: false,
            paths: Vec::new(),
        });
    }
    let url = check_git_remote_url(settings.url.as_deref()).map_err(ShellError::from)?;
    let config = RemoteConfig {
        url,
        token: settings.token.filter(|token| !token.is_empty()),
        username: None,
    };
    let token = config.token.clone();
    let batch = match queue
        .run(GIT_TIMEOUT, move || {
            pull_listing(&FolderRepo::new(&root), &config)
        })
        .await
    {
        Ok(Ok(batch)) => batch,
        Ok(Err(error)) => {
            let reason = git_reason(&error.to_string());
            return Err(ShellError::from(redact_secret_for(
                &reason,
                token.as_deref(),
                None,
            )));
        }
        Err(queued) => return Err(ShellError::from(queued_reason(queued))),
    };
    let pulled = matches!(
        batch.outcome,
        PullOutcome::FastForward { .. } | PullOutcome::Merged { .. }
    );
    if !batch.paths.is_empty() {
        index.inner().invalidate();
        let _ = app.emit(PULL_BATCH_EVENT, &batch.paths);
    }
    Ok(PullNowReply {
        pulled,
        paths: batch.paths,
    })
}

/// The commits that changed `path`, newest first.
///
/// # Errors
/// No folder chosen.
#[tauri::command]
#[specta::specta]
pub async fn git_file_history(
    vault: tauri::State<'_, VaultState>,
    path: String,
) -> Result<FileHistory, ShellError> {
    let commits = file_log(vault.inner(), &path, None)
        .await
        .map_err(ShellError::from)?;
    Ok(FileHistory {
        commits: commits
            .into_iter()
            .map(|commit| FileCommit {
                sha: commit.oid,
                at: commit.authored_at,
            })
            .collect(),
    })
}
