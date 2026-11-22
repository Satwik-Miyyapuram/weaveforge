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
    /// This device's state: `verified`, `incomplete`, `removing`, `removed`, `unexported` (the report
    /// exists but has no run from this device, so the export is offered), `unavailable`, or `none`
    /// when no report or export exists.
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
    let own = super::remove::own_run(&report, device_id).ok();
    let own_state = own.as_ref().and_then(|run| run["state"].as_str());
    let own_run_verified = own_state == Some("verified");
    let own_removed = report["removals"][device_id]["state"].as_str() == Some("removed");
    // Only this device's own removal entry (or the removal it started) makes it `removing`; another
    // device's removal never does, and the top-level state is not read for that.
    let own_removing = report["removals"][device_id]["state"].as_str() == Some("removing")
        || (report["state"].as_str() == Some("removing")
            && report["removingDeviceId"].as_str() == Some(device_id));
    let top_known = matches!(
        report["state"].as_str(),
        Some("verified" | "incomplete" | "removing" | "removed")
    );
    // This device's view, read before any top-level gate, so another device's top-level state
    // ("exporting", or an unknown value) never hides this device's removed or verified state.
    let state = if own_removed {
        "removed".to_owned()
    } else if own_removing {
        "removing".to_owned()
    } else {
        match own_state {
            Some(known @ ("verified" | "incomplete")) => known.to_owned(),
            Some(_) => "unavailable".to_owned(),
            // The report exists but has no run from this device: offer this device the export.
            None if top_known => "unexported".to_owned(),
            None => "unavailable".to_owned(),
        }
    };
    let backup = super::remove::backup_name(&report, device_id)
        .ok()
        .map(|name| folder.join(super::remove::MIGRATION_DIR).join(name));
    let mut kinds = super::remove::own_run_missing(&report, device_id).unwrap_or_default();
    kinds.sort();
    kinds.dedup();
    MigrationStatus {
        state,
        // This device's own removal only; another device's entry is not this device's removal.
        removed_at: report["removals"][device_id]["removedAt"]
            .as_str()
            .map(str::to_owned),
        // The verify time of this device's own verified run, not another device's top-level field.
        verified_at: own
            .as_ref()
            .filter(|run| run["state"].as_str() == Some("verified"))
            .and_then(|run| run["finishedAt"].as_str())
            .map(str::to_owned),
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
