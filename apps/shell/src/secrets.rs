//! Secrets in the OS keychain through keyring-core (design: phase-2-desktop.md § 2.8).

use std::sync::Arc;

use keyring_core::CredentialStore;

use crate::commands::ShellError;

/// Every secret the shell keeps. Adding one is a reviewed change.
pub const SECRET_NAMES: [&str; 4] = [
    "ai-provider",
    "local-api-token",
    "overleaf-token",
    "git-sync-token",
];
/// Secrets the page may read back.
pub const PAGE_READABLE: [&str; 1] = ["ai-provider"];
/// Secrets the page may write and clear.
pub const PAGE_WRITABLE: [&str; 3] = ["ai-provider", "overleaf-token", "git-sync-token"];

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
}

/// The keychain store and the service name every secret is filed under.
#[derive(Clone)]
pub struct Secrets {
    store: Option<Arc<CredentialStore>>,
    service: String,
}

impl Secrets {
    /// `store` is `None` when this machine has no keychain; `service` is the app identifier, so the
    /// Dev build keeps its own secrets.
    pub fn new(store: Option<Arc<CredentialStore>>, service: impl Into<String>) -> Self {
        Self {
            store,
            service: service.into(),
        }
    }

    /// The stored value, or `None` when nothing is stored or it cannot be read.
    pub fn read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&SECRET_NAMES, name)?;
        Ok(self
            .entry(name)
            .and_then(Result::ok)
            .and_then(|entry| entry.get_password().ok()))
    }

    /// Stores `value` under `name`, replacing any earlier value.
    pub fn write(&self, name: &str, value: &str) -> Result<(), SecretError> {
        known(&SECRET_NAMES, name)?;
        if value.is_empty() {
            return Err(SecretError::EmptyValue);
        }
        let entry = self.entry(name).ok_or(SecretError::NoKeychain)?;
        entry
            .map_err(|e| write_error(&e))?
            .set_password(value)
            .map_err(|e| write_error(&e))
    }

    /// Forgets `name`. Forgetting something never stored, or with no keychain, succeeds.
    pub fn clear(&self, name: &str) -> Result<(), SecretError> {
        known(&SECRET_NAMES, name)?;
        let Some(entry) = self.entry(name) else {
            return Ok(());
        };
        let entry = entry.map_err(|_| SecretError::Unreachable)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretError::Unreachable),
        }
    }

    /// `read`, for the page: only names in `PAGE_READABLE`.
    pub fn page_read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&PAGE_READABLE, name)?;
        self.read(name)
    }

    /// `write`, for the page: only names in `PAGE_WRITABLE`.
    pub fn page_write(&self, name: &str, value: &str) -> Result<(), SecretError> {
        known(&PAGE_WRITABLE, name)?;
        self.write(name, value)
    }

    /// `clear`, for the page: only names in `PAGE_WRITABLE`.
    pub fn page_clear(&self, name: &str) -> Result<(), SecretError> {
        known(&PAGE_WRITABLE, name)?;
        self.clear(name)
    }

    /// The credential for `name` under this service, or `None` without a keychain.
    fn entry(&self, name: &str) -> Option<Result<keyring_core::Entry, keyring_core::Error>> {
        self.store
            .as_ref()
            .map(|store| store.build(&self.service, name, None))
    }
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
        ShellError {
            message: error.to_string(),
        }
    }
}

/// Reads a secret the page may read.
#[tauri::command]
#[specta::specta]
pub async fn secret_read(
    secrets: tauri::State<'_, Secrets>,
    name: String,
) -> Result<Option<String>, ShellError> {
    let secrets = secrets.inner().clone();
    blocking(move || secrets.page_read(&name)).await
}

/// Stores a secret the page may write.
#[tauri::command]
#[specta::specta]
pub async fn secret_write(
    secrets: tauri::State<'_, Secrets>,
    name: String,
    value: String,
) -> Result<(), ShellError> {
    let secrets = secrets.inner().clone();
    blocking(move || secrets.page_write(&name, &value)).await
}

/// Forgets a secret the page may write.
#[tauri::command]
#[specta::specta]
pub async fn secret_clear(
    secrets: tauri::State<'_, Secrets>,
    name: String,
) -> Result<(), ShellError> {
    let secrets = secrets.inner().clone();
    blocking(move || secrets.page_clear(&name)).await
}

/// Runs a keychain call off the async runtime, since it can block on a prompt.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, SecretError> + Send + 'static,
) -> Result<T, ShellError> {
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => Ok(result?),
        Err(_) => Err(SecretError::Unreachable.into()),
    }
}
