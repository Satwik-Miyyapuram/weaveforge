//! Moves secrets an older version left in `.weaveforge/settings.json` to the keychain,
//! once, then strips them from the file (files-first L7). The file syncs through git; the
//! keychain does not.

use serde_json::{Map, Value};
use wf_core::settings::settings_file::{parse_settings, render_settings, split_legacy_secrets};
use wf_core::sync::folder_layout::SETTINGS_PATH;
use wf_core::sync::frontmatter::canonical_digest;
use wf_store::checked_write::WriteOutcome;
use wf_store::vault::Vault;

use crate::secrets::Secrets;
use crate::vault::VaultState;

/// Keychain entry holding the moved values: one JSON object keyed by where each value sat
/// in the settings file (for example `integrations.zotero.apiKey`).
pub const LEGACY_SECRET: &str = "settings-legacy";

/// Moves every secret in the workspace settings file to the [`LEGACY_SECRET`] keychain
/// entry, merged over what an earlier move kept there, then rewrites the file without them.
/// The file changes only after the keychain holds the values, and only if nobody changed it
/// meanwhile. Returns where the moved values sat (never the values); empty when the file is
/// missing, unreadable or holds no secret.
///
/// # Errors
/// Why the secrets stayed in the file: no keychain, a secret the move cannot strip (inside a
/// list), a keychain entry that is not a JSON object, or a file changed during the move.
pub fn move_legacy_secrets(vault: &Vault, secrets: &Secrets) -> Result<Vec<String>, String> {
    let Ok(original) = vault.read_text(SETTINGS_PATH) else {
        return Ok(Vec::new());
    };
    let Ok(settings) = parse_settings(&original) else {
        return Ok(Vec::new());
    };
    let (kept, moved) = split_legacy_secrets(&settings);
    if moved.is_empty() {
        return Ok(Vec::new());
    }
    let text = render_settings(&kept).map_err(|e| e.to_string())?;
    let mut merged: Map<String, Value> = match secrets.read(LEGACY_SECRET) {
        Ok(Some(earlier)) => serde_json::from_str(&earlier)
            .map_err(|_| format!("The {LEGACY_SECRET} keychain entry is not a JSON object."))?,
        Ok(None) => Map::new(),
        Err(e) => return Err(e.to_string()),
    };
    let mut locations: Vec<String> = moved.keys().cloned().collect();
    locations.sort_unstable();
    merged.extend(moved);
    let stored = Value::Object(merged).to_string();
    secrets
        .write(LEGACY_SECRET, &stored)
        .map_err(|e| e.to_string())?;
    if secrets.read(LEGACY_SECRET).ok().flatten().as_deref() != Some(stored.as_str()) {
        return Err("The keychain did not keep the settings secrets.".to_owned());
    }
    match vault.write_text_checked(SETTINGS_PATH, &text, Some(&canonical_digest(&original))) {
        Ok(WriteOutcome::Written { .. }) => Ok(locations),
        Ok(WriteOutcome::Changed { .. }) => {
            Err("settings.json changed during the move.".to_owned())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// [`move_legacy_secrets`] on the open workspace, queued with the other keychain writes.
/// Logs where secrets were moved from, or why they stayed; never the values.
pub async fn move_for_open_vault(vault: VaultState, secrets: Secrets) {
    let result = secrets
        .queued(move |s| {
            let session = vault.lock();
            Ok(session
                .vault()
                .map_or_else(|_| Ok(Vec::new()), |v| move_legacy_secrets(v, s)))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(std::convert::identity);
    match result {
        Ok(moved) if !moved.is_empty() => {
            eprintln!(
                "[settings] moved secrets to the keychain: {}",
                moved.join(", ")
            );
        }
        Ok(_) => {}
        Err(why) => eprintln!("[settings] secrets left in settings.json: {why}"),
    }
}
