//! Secrets in the OS keychain through keyring-core (design: phase-2-desktop.md § 2.8).

use std::sync::Arc;

use keyring_core::CredentialStore;

use crate::commands::ShellError;

/// Every secret the shell keeps. Adding one is a reviewed change.
pub const SECRET_NAMES: [&str; 7] = [
    "ai-provider",
    "local-api-token",
    "overleaf-token",
    "git-sync-token",
    "overleaf-session",
    // Secrets moved out of an older settings.json (`settings_secrets.rs`); shell only.
    "settings-legacy",
    // This device's integration credentials, as JSON (the page's DeviceSecretsStore).
    "device-secrets",
];
/// Secrets the page may read back.
pub const PAGE_READABLE: [&str; 2] = ["ai-provider", "device-secrets"];
/// Secrets the page may write and clear but never read back, even as a device field. The camelCase
/// names are the device-field keys the migration writes (`device-secrets/overleafToken`).
pub const WRITE_ONLY: [&str; 4] = [
    "overleaf-token",
    "git-sync-token",
    "overleafToken",
    "gitSyncToken",
];
/// Secrets the page may write and clear.
pub const PAGE_WRITABLE: [&str; 4] = [
    "ai-provider",
    "overleaf-token",
    "git-sync-token",
    "device-secrets",
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
    /// The old device row holds more than one secrets row; the keychain keeps one entry.
    #[error("This device has more than one saved secrets row, so nothing was moved.")]
    SeveralRows,
    /// Every secret is in the keychain, but the record of the move could not be written.
    #[error(
        "The secrets are in the keychain, but the move could not be recorded, so it will run again."
    )]
    MarkerFailed,
    /// The keychain is locked, so the saved credentials cannot be read. Nothing was changed.
    #[error(
        "The keychain is locked, so the saved credentials cannot be read. Unlock it and try again. Nothing was changed."
    )]
    Locked,
    /// The old device row is not the expected JSON.
    #[error("The saved credentials on this device could not be read, so nothing was moved.")]
    BadRow,
    /// The keychain's index of saved fields is damaged. Resetting it (clearing `device-secrets/_index`)
    /// lets the move run again.
    #[error(
        "The saved credentials index on this device is damaged, so nothing was moved. Reset it to continue."
    )]
    CorruptIndex,
}

/// The name the device's credentials are filed under. Each field is one keychain entry,
/// `device-secrets/<key>`, because Windows caps a single credential blob at 2560 bytes.
pub const DEVICE_SECRETS: &str = "device-secrets";

/// Whether `name` is one field entry of the device's credentials (`device-secrets/<key>`). The index
/// entry `device-secrets/_index` counts; every other key that starts with `_` is reserved.
#[must_use]
pub fn is_device_field(name: &str) -> bool {
    name.strip_prefix("device-secrets/").is_some_and(|key| {
        !key.is_empty()
            && key.len() <= 128
            && (key == "_index" || !key.starts_with('_'))
            && key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
    })
}

/// The keychain store and the service name every secret is filed under.
#[derive(Clone)]
pub struct Secrets {
    store: Option<Arc<CredentialStore>>,
    service: String,
    /// One write or clear at a time, in the order they were asked (the lock is FIFO).
    writes: Arc<tokio::sync::Mutex<()>>,
}

impl Secrets {
    /// `store` is `None` when this machine has no keychain; `service` is the app identifier, so the
    /// Dev build keeps its own secrets.
    pub fn new(store: Option<Arc<CredentialStore>>, service: impl Into<String>) -> Self {
        Self {
            store,
            service: service.into(),
            writes: Arc::new(tokio::sync::Mutex::new(())),
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

    /// The stored value, or `None` only when nothing is stored (`NoEntry`). A missing, locked or
    /// unreachable keychain is an error, so the caller never mistakes it for an empty store and
    /// overwrites what is there.
    pub fn read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&SECRET_NAMES, name)?;
        let entry = self.entry(name).ok_or(SecretError::NoKeychain)?;
        let entry = entry.map_err(|e| read_error(&e))?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(read_error(&e)),
        }
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

    /// Startup: forgets the Overleaf token that 0.9.7 stored. Idempotent; other names are kept.
    pub fn retire_overleaf_token(&self) -> Result<(), SecretError> {
        self.clear("overleaf-token")
    }

    /// `read`, for the page: only names in `PAGE_READABLE`.
    pub fn page_read(&self, name: &str) -> Result<Option<String>, SecretError> {
        known(&PAGE_READABLE, name)?;
        if is_write_only(name) {
            return Err(SecretError::UnknownName);
        }
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

/// Whether `name` is a write-only token, or a device field of one (`device-secrets/<token>.<sub>`).
fn is_write_only(name: &str) -> bool {
    let key = name.strip_prefix("device-secrets/").unwrap_or(name);
    let top = key.split('.').next().unwrap_or(key);
    WRITE_ONLY.contains(&top)
}

/// Refuses a name outside `list`. The match is exact, except that any device field entry is
/// allowed wherever the device credentials are.
fn known(list: &[&str], name: &str) -> Result<(), SecretError> {
    if list.contains(&name) || (list.contains(&DEVICE_SECRETS) && is_device_field(name)) {
        Ok(())
    } else {
        Err(SecretError::UnknownName)
    }
}

/// Maps a keychain failure during a read to the reader-facing reason.
fn read_error(error: &keyring_core::Error) -> SecretError {
    match error {
        keyring_core::Error::NoStorageAccess(_) => SecretError::Locked,
        keyring_core::Error::NoDefaultStore | keyring_core::Error::NotSupportedByStore(_) => {
            SecretError::NoKeychain
        }
        _ => SecretError::Unreachable,
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
