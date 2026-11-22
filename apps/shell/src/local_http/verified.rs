//! Which storage path the open folder uses, from its 0.9.7 migration report
//! (`.weaveforge/migration-0.9.7/report.json`). A missing, unreadable or
//! unparsable report, or a report this device cannot vouch for, means the
//! database path stays in charge.

use serde_json::Value;

use crate::vault::VaultState;

/// The 0.9.7 migration report, inside the chosen folder.
const REPORT_PATH: &str = ".weaveforge/migration-0.9.7/report.json";

/// The storage path the local API uses for the open folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderMode {
    /// No usable report: the SQL/database routes, unchanged.
    Database,
    /// Verified, or being removed: SDK, MCP and milestones read workspace files.
    Files,
    /// Export running or done: SDK routes answer 503 until the report settles.
    Migrating,
}

/// Maps a report `state` to its mode. Unknown states keep the database path.
#[must_use]
pub fn mode_for_state(state: &str) -> FolderMode {
    match state {
        "verified" | "removing" | "removed" => FolderMode::Files,
        "exporting" | "exported" => FolderMode::Migrating,
        _ => FolderMode::Database,
    }
}

/// Whether the report was written by this device. Until EXPORT's
/// `report_is_local_verified(folder)` lands, every report passes; swap the
/// body here and nothing else changes.
#[must_use]
pub fn report_is_local_verified(report: &Value) -> bool {
    let _ = report;
    true
}

/// The storage path for the chosen folder, read from its migration report.
#[must_use]
pub fn folder_mode(vault: &VaultState) -> FolderMode {
    let session = vault.lock();
    let Ok(Some(text)) = session.read_text(REPORT_PATH) else {
        return FolderMode::Database;
    };
    let Ok(report) = serde_json::from_str::<Value>(&text) else {
        return FolderMode::Database;
    };
    if !report_is_local_verified(&report) {
        return FolderMode::Database;
    }
    report
        .get("state")
        .and_then(Value::as_str)
        .map_or(FolderMode::Database, mode_for_state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_removing_and_removed_are_files_only() {
        for state in ["verified", "removing", "removed"] {
            assert_eq!(mode_for_state(state), FolderMode::Files, "state {state}");
        }
    }

    #[test]
    fn exporting_and_exported_are_migrating() {
        for state in ["exporting", "exported"] {
            assert_eq!(mode_for_state(state), FolderMode::Migrating, "state {state}");
        }
    }

    #[test]
    fn none_incomplete_and_unknown_keep_the_database() {
        for state in ["none", "incomplete", "something-else", ""] {
            assert_eq!(mode_for_state(state), FolderMode::Database, "state {state}");
        }
    }
}
