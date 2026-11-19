//! The open workspace's tier (modes-093 sections 6 and 8). Read from `.weaveforge/settings.json`
//! when a folder opens; the tier gate and the page read it here. Only `workspace_set_tier`
//! changes the file's tier.

use std::sync::RwLock;

use wf_core::settings::workspace_settings::{
    SETTINGS_PATH, WorkspaceSettings, tier_from_name, tier_name,
};
use wf_core::sync::tier_merge::Tier;

use crate::commands::ShellError;
use crate::vault::{VaultSession, VaultState};

/// Said when a tier change is asked for with no folder open.
pub const NO_FOLDER: &str = "Open a workspace folder first.";
/// Said when the page names a tier that does not exist.
pub const BAD_TIER: &str = "That is not a workspace tier.";
/// Said when the settings file cannot be read or written; nothing changes.
pub const NOT_SAVED: &str = "The workspace settings could not be saved.";

/// The open workspace's id and tier, as the page sees them.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenTier {
    /// Random v4 id from `settings.json`.
    pub workspace_id: String,
    /// "local", "local-web" or "sharing".
    pub tier: String,
    /// Bumped on every tier change; one per decision, so it fits a JS number.
    #[specta(type = u32)]
    pub tier_epoch: u64,
    /// The account that set the tier, if any.
    pub tier_account: Option<String>,
    /// Host of the server profile used to raise the tier, if any.
    pub server_hint: Option<String>,
}

static OPEN: RwLock<Option<OpenTier>> = RwLock::new(None);

/// The open workspace's id and tier from its settings, or nothing when it has no id yet.
pub fn open_tier_of(settings: &WorkspaceSettings) -> Option<OpenTier> {
    let workspace_id = settings.tier.workspace_id.clone()?;
    Some(OpenTier {
        workspace_id,
        tier: tier_name(settings.tier.tier).to_owned(),
        tier_epoch: settings.tier.tier_epoch,
        tier_account: settings.tier.tier_account.clone(),
        server_hint: settings.server_hint.clone(),
    })
}

/// Stores the open workspace's tier for later reads. Pass `None` when the folder is closed.
pub fn remember(settings: Option<&WorkspaceSettings>) {
    let value = settings.and_then(open_tier_of);
    match OPEN.write() {
        Ok(mut guard) => *guard = value,
        Err(poisoned) => *poisoned.into_inner() = value,
    }
}

/// The open workspace's id and tier, or `None` when no folder is open.
pub fn current() -> Option<OpenTier> {
    match OPEN.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// The open workspace's tier as a typed value, or `None` when no folder is open.
pub fn current_tier() -> Option<Tier> {
    current().and_then(|open| tier_from_name(&open.tier))
}

/// Moves the open folder's workspace to `tier` and writes `settings.json`, bumping the epoch.
///
/// # Errors
/// No folder open, an unknown tier name, or the settings file could not be read or written.
/// On any error the file is left as it was.
pub fn change_tier(
    session: &VaultSession,
    tier: &str,
    account: Option<&str>,
    server_hint: Option<&str>,
) -> Result<OpenTier, String> {
    if session.root().is_none() {
        return Err(NO_FOLDER.to_owned());
    }
    let Some(new_tier) = tier_from_name(tier) else {
        return Err(BAD_TIER.to_owned());
    };
    let text = match session.read_text(SETTINGS_PATH) {
        Ok(Some(text)) => text,
        _ => return Err(NOT_SAVED.to_owned()),
    };
    let mut settings = WorkspaceSettings::parse(&text).map_err(|_| NOT_SAVED.to_owned())?;
    if settings.set_tier(new_tier, account, server_hint) {
        let text = settings.to_text().map_err(|_| NOT_SAVED.to_owned())?;
        session
            .write_text(SETTINGS_PATH, &text)
            .map_err(|_| NOT_SAVED.to_owned())?;
    }
    remember(Some(&settings));
    open_tier_of(&settings).ok_or_else(|| NOT_SAVED.to_owned())
}

/// The open workspace's id and tier, or nothing when no folder is open.
///
/// # Errors
/// Never; the answer is always `Ok`.
#[tauri::command]
#[specta::specta]
pub async fn workspace_tier() -> Result<Option<OpenTier>, ShellError> {
    Ok(current())
}

/// Moves the open workspace to `tier` and writes `settings.json` (epoch + 1).
/// The page passes the signed-in account and the server host; the workspace comes from the open folder.
///
/// # Errors
/// No folder open, an unknown tier, or the file could not be read or written; nothing changes.
#[tauri::command]
#[specta::specta]
pub async fn workspace_set_tier(
    vault: tauri::State<'_, VaultState>,
    tier: String,
    account: Option<String>,
    server_hint: Option<String>,
) -> Result<OpenTier, ShellError> {
    let vault = vault.inner().clone();
    tokio::task::spawn_blocking(move || {
        let session = vault.lock();
        change_tier(&session, &tier, account.as_deref(), server_hint.as_deref())
    })
    .await
    .unwrap_or_else(|_| Err(NOT_SAVED.to_owned()))
    .map_err(ShellError::from)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    /// A clean folder under the temp dir, unique to this test.
    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wf-opentier-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("folder");
        dir
    }

    /// Opens a fresh folder with a settings file that has an id, local tier and epoch 0.
    fn open_with_settings(name: &str) -> VaultSession {
        let dir = folder(name);
        let mut session = VaultSession::new();
        let _ = session.adopt(Some(&dir)).expect("adopt");
        session
            .write_text(
                SETTINGS_PATH,
                "{\"workspaceId\":\"id-1\",\"tier\":\"local\",\"tierEpoch\":0}\n",
            )
            .expect("write settings");
        session
    }

    #[test]
    fn raising_writes_the_tier_and_bumps_the_epoch() {
        let session = open_with_settings("raise");
        let open =
            change_tier(&session, "sharing", Some("acct"), Some("weaveforge.org")).expect("raise");
        assert_eq!(open.tier, "sharing");
        assert_eq!(open.tier_epoch, 1);
        assert_eq!(open.workspace_id, "id-1");
        let text = session
            .read_text(SETTINGS_PATH)
            .expect("read")
            .expect("file");
        let settings = WorkspaceSettings::parse(&text).expect("parse");
        assert_eq!(settings.tier.tier, Tier::Sharing);
        assert_eq!(settings.tier.tier_epoch, 1);
    }

    #[test]
    fn the_same_tier_twice_writes_once() {
        let session = open_with_settings("twice");
        let first = change_tier(&session, "local-web", None, None).expect("first");
        let second = change_tier(&session, "local-web", None, None).expect("second");
        assert_eq!(first.tier_epoch, 1);
        assert_eq!(second.tier_epoch, 1);
    }

    #[test]
    fn an_unknown_tier_is_refused_and_the_file_is_unchanged() {
        let session = open_with_settings("unknown");
        let before = session.read_text(SETTINGS_PATH).expect("read");
        assert_eq!(
            change_tier(&session, "Sharing", None, None),
            Err(BAD_TIER.to_owned())
        );
        assert_eq!(session.read_text(SETTINGS_PATH).expect("read"), before);
    }

    #[test]
    fn no_folder_is_refused() {
        let session = VaultSession::new();
        assert_eq!(
            change_tier(&session, "local", None, None),
            Err(NO_FOLDER.to_owned())
        );
    }

    #[test]
    fn a_missing_settings_file_is_refused() {
        let dir = folder("missing");
        let mut session = VaultSession::new();
        let _ = session.adopt(Some(&dir)).expect("adopt");
        assert_eq!(
            change_tier(&session, "sharing", None, None),
            Err(NOT_SAVED.to_owned())
        );
    }
}
