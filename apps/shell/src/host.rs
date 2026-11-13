//! Narrow traits over the shell's preferences, secrets, opener and window, so the local API can use fakes in tests.

use std::path::Path;

use serde_json::Value;

use crate::prefs::{PrefValue, Prefs};
use crate::secrets::Secrets;

/// Preference access, so tests need no file.
pub trait PrefAccess: Send + Sync {
    /// The stored value, if any.
    fn read(&self, name: &str) -> Result<Option<PrefValue>, String>;
    /// Stores or clears (`None`) a value.
    fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String>;
}

/// Secret access, so tests need no keychain.
pub trait SecretAccess: Send + Sync {
    /// The stored value, if any.
    fn read(&self, name: &str) -> Result<Option<String>, String>;
    /// Stores a value under `name`, replacing any earlier one.
    fn write(&self, name: &str, value: &str) -> Result<(), String>;
    /// Forgets `name`.
    fn clear(&self, name: &str) -> Result<(), String>;
}

/// The OS handlers for links and files.
pub trait Opener: Send + Sync {
    /// Opens a link with its registered handler.
    fn open_url(&self, url: &str) -> Result<(), String>;
    /// Opens a file with its registered handler.
    fn open_path(&self, path: &Path) -> Result<(), String>;
}

/// Sends an event to the app window.
pub trait WindowEvents: Send + Sync {
    /// Emits `event` with `payload` to the window.
    fn emit(&self, event: &str, payload: Value);
}

impl PrefAccess for Prefs {
    fn read(&self, name: &str) -> Result<Option<PrefValue>, String> {
        crate::prefs::Prefs::read(self, name).map_err(|e| e.to_string())
    }

    fn write(&self, name: &str, value: Option<PrefValue>) -> Result<(), String> {
        crate::prefs::Prefs::write(self, name, value).map_err(|e| e.to_string())
    }
}

impl SecretAccess for Secrets {
    fn read(&self, name: &str) -> Result<Option<String>, String> {
        crate::secrets::Secrets::read(self, name).map_err(|e| e.to_string())
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        crate::secrets::Secrets::write(self, name, value).map_err(|e| e.to_string())
    }

    fn clear(&self, name: &str) -> Result<(), String> {
        crate::secrets::Secrets::clear(self, name).map_err(|e| e.to_string())
    }
}

impl<R: tauri::Runtime> WindowEvents for tauri::AppHandle<R> {
    fn emit(&self, event: &str, payload: Value) {
        let _ = tauri::Emitter::emit(self, event, payload);
    }
}
