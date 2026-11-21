//! This machine's settings file, `.weaveforge/local/device.json` (files-first L7). It is
//! local metadata, never synced, and holds no secrets: secrets go to the keychain.

use std::io::ErrorKind;

use serde_json::{Map, Value};
use wf_core::settings::settings_file::{
    apply_patch, parse_object, parse_settings, render_settings,
};
use wf_core::sync::folder_layout::DEVICE_SETTINGS_PATH;
use wf_core::sync::frontmatter::canonical_digest;
use wf_store::checked_write::WriteOutcome;
use wf_store::vault::{Vault, VaultError};

use crate::commands::ShellError;
use crate::vault::VaultState;

/// How often a patch retries when the file changed between its read and its write.
const PATCH_TRIES: usize = 3;

/// The file's settings and the digest a checked write expects; `""` for a missing file.
fn load(vault: &Vault) -> Result<(Map<String, Value>, String), String> {
    match vault.read_text(DEVICE_SETTINGS_PATH) {
        Ok(text) => {
            let settings = parse_settings(&text).map_err(|e| e.to_string())?;
            Ok((settings, canonical_digest(&text)))
        }
        Err(VaultError::Io { source, .. }) if source.kind() == ErrorKind::NotFound => {
            Ok((Map::new(), String::new()))
        }
        Err(e) => Err(e.to_string()),
    }
}

/// The device settings as JSON object text; `{}` when the file is missing.
///
/// # Errors
/// The file cannot be read or is not a JSON object.
pub fn read_device_settings(vault: &Vault) -> Result<String, String> {
    load(vault).map(|(settings, _)| Value::Object(settings).to_string())
}

/// Sets the keys `patch` (JSON object text) names and removes those it sets to `null`,
/// then returns the new settings. The write only lands on the file that was read, so a
/// concurrent write is never lost; a corrupt file is never overwritten.
///
/// # Errors
/// The patch is not a JSON object, the result would hold a secret, the file is corrupt or
/// unwritable, or it kept changing under the patch.
pub fn patch_device_settings(vault: &Vault, patch: &str) -> Result<String, String> {
    let patch = parse_object(patch).map_err(|e| e.to_string())?;
    for _ in 0..PATCH_TRIES {
        let (current, expected) = load(vault)?;
        let next = apply_patch(&current, &patch);
        let text = render_settings(&next).map_err(|e| e.to_string())?;
        match vault.write_text_checked(DEVICE_SETTINGS_PATH, &text, Some(&expected)) {
            Ok(WriteOutcome::Written { .. }) => return Ok(Value::Object(next).to_string()),
            Ok(WriteOutcome::Changed { .. }) => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("The device settings file kept changing; try again.".to_owned())
}

/// Reads this machine's settings (JSON object text).
///
/// # Errors
/// No folder chosen, or the file cannot be read or is not a JSON object.
#[tauri::command]
#[specta::specta]
pub async fn device_settings_read(
    state: tauri::State<'_, VaultState>,
) -> Result<String, ShellError> {
    crate::cmd_files::on_vault(state.inner(), read_device_settings).await
}

/// Patches this machine's settings with `patch` (JSON object text); returns the result.
///
/// # Errors
/// See [`patch_device_settings`]; also no folder chosen.
#[tauri::command]
#[specta::specta]
pub async fn device_settings_patch(
    state: tauri::State<'_, VaultState>,
    patch: String,
) -> Result<String, ShellError> {
    crate::cmd_files::on_vault(state.inner(), move |vault| {
        patch_device_settings(vault, &patch)
    })
    .await
}
