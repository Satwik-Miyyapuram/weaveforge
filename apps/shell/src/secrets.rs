//! Secrets in the OS keychain through keyring-core (design: phase-2-desktop.md § 2.8).

use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use keyring_core::CredentialStore;

use crate::commands::ShellError;

#[cfg(test)]
#[path = "secrets_tests.rs"]
mod tests;

/// Every secret the shell keeps. Adding one is a reviewed change.
pub const SECRET_NAMES: [&str; 8] = [
    "ai-provider",
    "local-api-token",
    "overleaf-token",
    "git-sync-token",
    "overleaf-session",
    "zotero-api-key",
    "mattermost-token",
    "repo-link-token",
];
/// Secrets that belong to this machine and are kept under their plain name.
const DEVICE_NAMES: [&str; 2] = ["ai-provider", "local-api-token"];
/// Secrets the page may read back.
pub const PAGE_READABLE: [&str; 1] = ["ai-provider"];
/// Secrets the page may write and clear.
pub const PAGE_WRITABLE: [&str; 6] = [
    "ai-provider",
    "overleaf-token",
    "git-sync-token",
    "zotero-api-key",
    "mattermost-token",
    "repo-link-token",
];

/// Why a secret call was refused. The Display text is shown to the reader as-is.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SecretError {
    /// The name is not one of `SECRET_NAMES`.
    #[error("That is not something this app stores.")]
    UnknownName,
    /// The value is the empty string.
    #[error("A secret is a non-empty string.")]
    EmptyValue,
    /// This machine has no keychain to store into.
    #[error(
        "This machine has no keychain available, so there is nowhere safe to keep it. It stays in memory for this session."
    )]
    NoKeychain,
    /// The keychain refused the value as too long.
    #[error("That is too long for this machine's keychain, so nothing was changed.")]
    TooLong,
    /// The keychain failed for a reason other than the above.
    #[error("The keychain could not be reached just now, so nothing was changed.")]
    Unreachable,
    /// A workspace secret was asked for while no workspace is open.
    #[error("Open a workspace first, so the token has somewhere to be kept.")]
    NoWorkspace,
    /// The workspace id is not a plain id (letters, digits and dashes).
    #[error("That workspace id is not valid, so nothing was changed.")]
    BadWorkspace,
}

/// The keychain store and the service name every secret is filed under.
#[derive(Clone)]
pub struct Secrets {
    store: Option<Arc<CredentialStore>>,
    service: String,
    /// One write or clear at a time, in the order they were asked (the lock is FIFO).
    writes: Arc<tokio::sync::Mutex<()>>,
    /// Held for each keychain read-modify-write, so a legacy migration never interleaves with a write or clear.
    storage: Arc<Mutex<()>>,
    /// The workspace whose tokens are in use, or `None` before any workspace is open.
    open: Arc<RwLock<Option<String>>>,
}

impl Secrets {
    /// `store` is `None` when this machine has no keychain; `service` is the app identifier, so the
    /// Dev build keeps its own secrets.
    pub fn new(store: Option<Arc<CredentialStore>>, service: impl Into<String>) -> Self {
        Self {
            store,
            service: service.into(),
            writes: Arc::new(tokio::sync::Mutex::new(())),
            storage: Arc::new(Mutex::new(())),
            open: Arc::new(RwLock::new(None)),
        }
    }

    /// Runs `work` off the async runtime after every earlier queued call has finished, in the
    /// order the calls were made, so a clear is never undone by a write sent just before it.
    pub async fn queued<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Secrets) -> Result<T, SecretError> + Send + 'static,
    ) -> Result<T, SecretError> {
        let turn = Arc::clone(&self.writes).lock_owned().await;
        let secrets = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _turn = turn;
            work(&secrets)
        })
        .await
        .unwrap_or(Err(SecretError::Unreachable))
    }

    /// Sets the workspace whose tokens later calls use, or `None` to close it. Workspace ids are
    /// letters, digits and dashes only, so they can sit safely inside a keychain name.
    pub fn set_open_workspace(&self, id: Option<&str>) -> Result<(), SecretError> {
        let next = match id {
            None => None,
            Some(id) if valid_workspace_id(id) => Some(id.to_owned()),
            Some(_) => return Err(SecretError::BadWorkspace),
        };
        *self
            .open
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = next;
        Ok(())
    }

    /// The stored value, or `None` when nothing is stored or it cannot be read. With a workspace
    /// open, a token that only the old unscoped name holds is copied into the workspace on first
    /// use. The unscoped token is kept, so every other workspace can still inherit it.
    pub fn read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&SECRET_NAMES, name)?;
        let _storage = self.lock_storage();
        let Some(workspace) = self.scoped_workspace(name) else {
            return Ok(self.read_user(name));
        };
        let scoped = scoped_key(&workspace, name);
        match self.lookup(&scoped) {
            Ok(Some(value)) => return Ok(Some(value)),
            // Unreadable, not absent: report nothing, and never copy over a slot that may hold a token.
            Err(()) => return Ok(None),
            Ok(None) => {}
        }
        // A workspace that cleared this token stays cleared. An unreadable marker counts as set.
        if !matches!(self.lookup(&migrated_key(&workspace, name)), Ok(None)) {
            return Ok(None);
        }
        let Ok(Some(value)) = self.lookup(name) else {
            return Ok(None);
        };
        // Best effort: if the copy fails, the next read copies again.
        let _ = self.write_user(&scoped, &value);
        Ok(Some(value))
    }

    /// Stores `value` under `name`, replacing any earlier value. The unscoped token is never
    /// touched, so other workspaces keep theirs.
    pub fn write(&self, name: &str, value: &str) -> Result<(), SecretError> {
        known(&SECRET_NAMES, name)?;
        if value.is_empty() {
            return Err(SecretError::EmptyValue);
        }
        let _storage = self.lock_storage();
        let user = match self.scoped_workspace(name) {
            None => name.to_owned(),
            Some(workspace) => scoped_key(&workspace, name),
        };
        self.write_user(&user, value)
    }

    /// Forgets `name`. Forgetting something never stored, or with no keychain, succeeds. In a
    /// workspace it forgets only that workspace's token and records that the workspace cleared it,
    /// so the unscoped token is never re-imported there. The unscoped token is never touched.
    pub fn clear(&self, name: &str) -> Result<(), SecretError> {
        known(&SECRET_NAMES, name)?;
        let _storage = self.lock_storage();
        match self.scoped_workspace(name) {
            None => self.delete_user(name),
            Some(workspace) => {
                if self.store.is_none() {
                    return Ok(());
                }
                // The marker goes first: if it cannot be written, nothing is forgotten and the token stays.
                self.write_user(&migrated_key(&workspace, name), "cleared")?;
                self.delete_user(&scoped_key(&workspace, name))
            }
        }
    }

    /// `read`, for the page: only names in `PAGE_READABLE`.
    pub fn page_read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&PAGE_READABLE, name)?;
        self.read(name)
    }

    /// `write`, for the page: only names in `PAGE_WRITABLE`, and workspace names only with a
    /// workspace open.
    pub fn page_write(&self, name: &str, value: &str) -> Result<(), SecretError> {
        known(&PAGE_WRITABLE, name)?;
        self.require_workspace(name)?;
        self.write(name, value)
    }

    /// `clear`, for the page: only names in `PAGE_WRITABLE`, and workspace names only with a
    /// workspace open.
    pub fn page_clear(&self, name: &str) -> Result<(), SecretError> {
        known(&PAGE_WRITABLE, name)?;
        self.require_workspace(name)?;
        self.clear(name)
    }

    /// The open workspace when `name` is kept per workspace, else `None`.
    fn scoped_workspace(&self, name: &str) -> Option<String> {
        if DEVICE_NAMES.contains(&name) {
            return None;
        }
        self.open
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Refuses a workspace secret when no workspace is open.
    fn require_workspace(&self, name: &str) -> Result<(), SecretError> {
        if DEVICE_NAMES.contains(&name) || self.scoped_workspace(name).is_some() {
            Ok(())
        } else {
            Err(SecretError::NoWorkspace)
        }
    }

    /// Holds the storage lock for one read-modify-write. The queue lock does not cover direct
    /// calls, and it is already held by `queued` while the work runs, so it cannot be taken here.
    fn lock_storage(&self) -> MutexGuard<'_, ()> {
        self.storage
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The password under the keychain user `user`: `Ok(None)` when it is absent or there is no
    /// keychain, `Err` when the keychain could not be asked.
    fn lookup(&self, user: &str) -> Result<Option<String>, ()> {
        let Some(entry) = self.entry(user) else {
            return Ok(None);
        };
        let entry = entry.map_err(|_| ())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(()),
        }
    }

    /// The password under the keychain user `user`, or `None` when absent or unreadable.
    fn read_user(&self, user: &str) -> Option<String> {
        self.lookup(user).ok().flatten()
    }

    fn write_user(&self, user: &str, value: &str) -> Result<(), SecretError> {
        let entry = self.entry(user).ok_or(SecretError::NoKeychain)?;
        entry
            .map_err(|e| write_error(&e))?
            .set_password(value)
            .map_err(|e| write_error(&e))
    }

    fn delete_user(&self, user: &str) -> Result<(), SecretError> {
        let Some(entry) = self.entry(user) else {
            return Ok(());
        };
        let entry = entry.map_err(|_| SecretError::Unreachable)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretError::Unreachable),
        }
    }

    /// The credential for keychain user `user` under this service, or `None` without a keychain.
    fn entry(&self, user: &str) -> Option<Result<keyring_core::Entry, keyring_core::Error>> {
        self.store
            .as_ref()
            .map(|store| store.build(&self.service, user, None))
    }
}

/// The keychain user for a workspace secret.
fn scoped_key(workspace: &str, name: &str) -> String {
    format!("{workspace}/{name}")
}

/// The keychain user that records a workspace cleared `name`. "migrated" is not a secret name, so
/// it cannot collide with a scoped key.
fn migrated_key(workspace: &str, name: &str) -> String {
    format!("{workspace}/migrated/{name}")
}

/// A workspace id is non-empty and made of letters, digits and dashes.
fn valid_workspace_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Refuses a name outside `list`; the match is exact.
fn known(list: &[&str], name: &str) -> Result<(), SecretError> {
    if list.contains(&name) {
        Ok(())
    } else {
        Err(SecretError::UnknownName)
    }
}

/// Maps a keychain failure during a write to the reader-facing reason.
fn write_error(error: &keyring_core::Error) -> SecretError {
    match error {
        keyring_core::Error::NoStorageAccess(_)
        | keyring_core::Error::NoDefaultStore
        | keyring_core::Error::NotSupportedByStore(_) => SecretError::NoKeychain,
        keyring_core::Error::TooLong(_, _) => SecretError::TooLong,
        _ => SecretError::Unreachable,
    }
}

impl From<SecretError> for ShellError {
    fn from(error: SecretError) -> Self {
        ShellError::from(error.to_string())
    }
}

/// Reads a secret the page may read.
#[tauri::command]
#[specta::specta]
pub async fn secret_read(
    secrets: tauri::State<'_, Secrets>,
    name: String,
) -> Result<Option<String>, ShellError> {
    secrets
        .queued(move |s| s.page_read(&name))
        .await
        .map_err(ShellError::from)
}

/// Stores a secret the page may write.
#[tauri::command]
#[specta::specta]
pub async fn secret_write(
    secrets: tauri::State<'_, Secrets>,
    name: String,
    value: String,
) -> Result<(), ShellError> {
    secrets
        .queued(move |s| s.page_write(&name, &value))
        .await
        .map_err(ShellError::from)
}

/// Forgets a secret the page may write.
#[tauri::command]
#[specta::specta]
pub async fn secret_clear(
    secrets: tauri::State<'_, Secrets>,
    name: String,
) -> Result<(), ShellError> {
    secrets
        .queued(move |s| s.page_clear(&name))
        .await
        .map_err(ShellError::from)
}
