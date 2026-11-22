//! Read-only status for the 0.9.7 migration, the reply of `migrate_097_status`. Field names are
//! camelCase on the wire; the WEB lane codes against them. Optional fields are omitted when absent.

use std::fs;
use std::path::Path;

use serde::Serialize;

const REPORT_REL: &str = ".weaveforge/migration-0.9.7/report.json";

/// Status of the 0.9.7 migration as the UI sees it.
#[derive(Debug, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    /// `verified`, `incomplete`, `removing`, `removed`, or `none` when no readable report exists.
    pub state: String,
    /// When old data was removed (report.json `removedAt`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<String>,
    /// When the TS verify last passed (report.json `verifiedAt`); removal needs it at most 10 min old.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
    /// Folder named by `<pg_root>/exported-to.json`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_to: Option<String>,
    /// Absolute path of the PGDMP backup that "remove old data" checks, when that file exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    /// Kind names (from the newest run's `missing[]`) with unexported items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<Vec<String>>,
    /// The device this status was read on; only this device's own run and removal entry count.
    pub device_id: String,
    /// The device whose removal is in progress (report.json `removingDeviceId`), when any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removing_device_id: Option<String>,
    /// Whether `exported-to.json` names this folder, compared after canonicalizing both paths.
    pub exported_here: bool,
    /// Whether this device's latest run in report.json is verified.
    pub own_run_verified: bool,
}

/// Reads report.json, exported-to.json and the backup. Never writes and never fails. An unreadable
/// report is `removed` when the removed marker exists, `none` when report.json and exported-to.json
/// are both absent, and `unavailable` otherwise.
pub fn migration_status(folder: &Path, pg_root: &Path, device_id: &str) -> MigrationStatus {
    let exported = exported_to(pg_root);
    let exported_here = exported.as_deref().is_some_and(|name| same_folder(name, folder));
    let removed = super::remove::old_db_removed(pg_root);
    let report_text = fs::read_to_string(folder.join(REPORT_REL));
    let report: Option<serde_json::Value> = report_text
        .as_ref()
        .ok()
        .and_then(|text| serde_json::from_str(text).ok());
    let Some(report) = report else {
        let absent = matches!(&report_text, Err(e) if e.kind() == std::io::ErrorKind::NotFound);
        let state = if removed {
            "removed"
        } else if absent && exported.is_none() {
            // Nothing was ever exported here, so there is nothing to report as unavailable.
            "none"
        } else {
            "unavailable"
        };
        return MigrationStatus {
            state: state.to_owned(),
            removed_at: None,
            verified_at: None,
            exported_to: exported,
            backup_path: None,
            missing: None,
            device_id: device_id.to_owned(),
            // Removed here: this device's marker lets the wiring rule switch it to files.
            removing_device_id: removed.then(|| device_id.to_owned()),
            exported_here,
            own_run_verified: false,
        };
    };
    // A missing, non-string or unknown state is unavailable, never `none` (that is for an absent report).
    let state = match report["state"].as_str() {
        Some(known @ ("verified" | "incomplete" | "removing" | "removed")) => known.to_owned(),
        _ => "unavailable".to_owned(),
    };
    let own_run_verified = super::remove::own_run(&report, device_id)
        .is_ok_and(|run| run["state"].as_str() == Some("verified"));
    let backup = super::remove::backup_name(&report, device_id)
        .ok()
        .map(|name| folder.join(super::remove::MIGRATION_DIR).join(name));
    let mut kinds = super::remove::own_run_missing(&report, device_id).unwrap_or_default();
    kinds.sort();
    kinds.dedup();
    MigrationStatus {
        state,
        removed_at: report["removedAt"].as_str().map(str::to_owned),
        verified_at: report["verifiedAt"].as_str().map(str::to_owned),
        exported_to: exported,
        backup_path: backup
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned()),
        missing: (!kinds.is_empty()).then_some(kinds),
        device_id: device_id.to_owned(),
        removing_device_id: report["removingDeviceId"].as_str().map(str::to_owned),
        exported_here,
        own_run_verified,
    }
}

fn exported_to(pg_root: &Path) -> Option<String> {
    let text = fs::read_to_string(pg_root.join("exported-to.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value["folder"].as_str().map(str::to_owned)
}

/// Whether `exported` and `folder` are the same folder; a path that cannot be resolved is not.
fn same_folder(exported: &str, folder: &Path) -> bool {
    match (dunce::canonicalize(exported), dunce::canonicalize(folder)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}
