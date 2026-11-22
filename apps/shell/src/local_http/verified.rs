//! Which storage path the open folder uses, from its 0.9.7 migration status
//! (`migrate_097::status::migration_status`, which reads the folder's report and
//! this device's `exported-to.json`). Every SDK, MCP and SQL decision goes through
//! `folder_mode`, so one rule answers for all of them.

use std::path::{Path, PathBuf};

use crate::migrate_097::status::{MigrationStatus, migration_status};
use crate::vault::VaultState;

/// Where the 0.9.7 migration keeps its state outside the folder: the local cluster
/// root and this machine's id. Built once at startup and managed as Tauri state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeSource {
    /// The app's local cluster root (`exported-to.json` lives here).
    pub pg_root: PathBuf,
    /// This machine's device id.
    pub device_id: String,
}

impl ModeSource {
    /// Builds the source from an explicit cluster root and device id.
    #[must_use]
    pub fn new(pg_root: PathBuf, device_id: String) -> Self {
        Self { pg_root, device_id }
    }

    /// Filled once at startup from the same helpers the 0.9.7 migration commands use.
    pub fn from_app(app: &tauri::AppHandle) -> Result<Self, crate::commands::ShellError> {
        Ok(Self::new(
            crate::migrate_097::cmd::pg_root(app)?,
            crate::migrate_097::cmd::device_id(app)?,
        ))
    }
}

/// The storage path for the open folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// The database, read and write. Only when the migration is `none`.
    Database,
    /// The database, read only: GET and SELECT work, every write is refused.
    DatabaseReadOnly,
    /// Workspace files only. SQL is never run.
    Files,
    /// The status cannot be trusted: every SDK and MCP route answers 503.
    Unavailable,
}

/// Maps a migration status to the storage path. Pure, so the rules are tested directly.
#[must_use]
pub fn mode_for_status(status: &MigrationStatus) -> Mode {
    match status.state.as_str() {
        "none" => Mode::Database,
        "verified" if status.own_run_verified => Mode::Files,
        "removed" => Mode::Files,
        // Only the device that started the removal may treat the folder as files.
        "removing" if status.removing_device_id.as_deref() == Some(status.device_id.as_str()) => {
            Mode::Files
        }
        "verified" | "removing" | "incomplete" | "unexported" => Mode::DatabaseReadOnly,
        _ => Mode::Unavailable,
    }
}

/// The storage path for the chosen folder. Never writes. No open folder is `Unavailable`.
#[must_use]
pub fn folder_mode(vault: &VaultState, source: &ModeSource) -> Mode {
    let root = vault.lock().root();
    let Some(root) = root else {
        return Mode::Unavailable;
    };
    let status = migration_status(Path::new(&root.path), &source.pg_root, &source.device_id);
    mode_for_status(&status)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE: &str = "device-a";

    fn status(state: &str) -> MigrationStatus {
        MigrationStatus {
            state: state.to_owned(),
            removed_at: None,
            verified_at: None,
            exported_to: None,
            backup_path: None,
            missing: None,
            device_id: DEVICE.to_owned(),
            removing_device_id: None,
            exported_here: true,
            own_run_verified: true,
        }
    }

    #[test]
    fn only_none_is_the_read_write_database() {
        assert_eq!(mode_for_status(&status("none")), Mode::Database);
    }

    #[test]
    fn verified_by_this_device_is_files() {
        assert_eq!(mode_for_status(&status("verified")), Mode::Files);
    }

    #[test]
    fn verified_without_this_devices_own_run_is_read_only() {
        let mut unverified = status("verified");
        unverified.own_run_verified = false;
        assert_eq!(mode_for_status(&unverified), Mode::DatabaseReadOnly);
    }

    #[test]
    fn removed_is_files() {
        assert_eq!(mode_for_status(&status("removed")), Mode::Files);
    }

    #[test]
    fn removing_on_this_device_is_files() {
        let mut mine = status("removing");
        mine.removing_device_id = Some(DEVICE.to_owned());
        assert_eq!(mode_for_status(&mine), Mode::Files);
    }

    #[test]
    fn removing_from_another_device_fails_closed_to_read_only() {
        let mut theirs = status("removing");
        theirs.removing_device_id = Some("device-b".to_owned());
        assert_eq!(mode_for_status(&theirs), Mode::DatabaseReadOnly);
        assert_eq!(mode_for_status(&status("removing")), Mode::DatabaseReadOnly);
    }

    #[test]
    fn incomplete_is_read_only() {
        assert_eq!(mode_for_status(&status("incomplete")), Mode::DatabaseReadOnly);
    }

    #[test]
    fn unexported_is_read_only() {
        assert_eq!(mode_for_status(&status("unexported")), Mode::DatabaseReadOnly);
    }

    #[test]
    fn another_devices_verified_report_is_never_files() {
        let mut theirs = status("verified");
        theirs.own_run_verified = false;
        theirs.device_id = "device-b".to_owned();
        assert_eq!(mode_for_status(&theirs), Mode::DatabaseReadOnly);
    }

    #[test]
    fn unavailable_and_unknown_states_are_503() {
        for state in ["unavailable", "exporting", "something-else", ""] {
            assert_eq!(mode_for_status(&status(state)), Mode::Unavailable, "state {state}");
        }
    }

    #[test]
    fn mode_source_keeps_the_fixed_device_id() {
        let source = ModeSource::new(PathBuf::from("pg"), DEVICE.to_owned());
        assert_eq!(source.device_id, DEVICE);
        assert_eq!(source.pg_root, PathBuf::from("pg"));
    }
}
