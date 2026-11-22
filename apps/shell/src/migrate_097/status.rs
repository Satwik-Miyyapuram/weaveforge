//! Read-only status for the 0.9.7 migration, the reply of `migrate_097_status`. Field names are
//! camelCase on the wire; the WEB lane codes against them. Optional fields are omitted when absent.

use std::fs;
use std::path::Path;

use serde::Serialize;

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
    /// Why the migration reports cannot be read (an unreadable conflict copy, a failed listing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// The step the user takes to clear `reason`, when one is known (for example
    /// "delete the conflict copy <name>").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

/// Reads every migration report in the folder (report.json, this device's own file and conflict
/// copies), exported-to.json and the backup. Never writes and never fails. One unreadable report or a
/// failed listing makes the status unavailable, with `reason` and `step` set. Otherwise this device's
/// state comes from its own file, else the legacy report.json. An unreadable report is `removed` when
/// the removed marker exists, `none` when no report and no export exist, and `unavailable` otherwise.
pub fn migration_status(folder: &Path, pg_root: &Path, device_id: &str) -> MigrationStatus {
    let exported = exported_to(pg_root);
    let exported_here = exported.as_deref().is_some_and(|name| same_folder(name, folder));
    let removed = super::remove::old_db_removed(pg_root);
    let (reports, problem) = match super::remove::read_reports(folder, device_id) {
        Ok(reports) => (reports, None),
        Err(problem) => (Vec::new(), Some(problem)),
    };
    let Some(report) = super::remove::base_report(&reports, device_id).cloned() else {
        let absent = reports.is_empty() && problem.is_none();
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
            reason: problem.as_ref().map(super::remove::ReportsError::reason),
            step: problem.as_ref().and_then(super::remove::ReportsError::step),
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
    // Gate first: a top-level state outside the known set is unavailable for every device.
    // No writer sets an "exporting" top-level state; known states are read per device below.
    let state = if !top_known {
        "unavailable".to_owned()
    } else if own_removed {
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
        reason: None,
        step: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unreadable_conflict_copy_makes_the_status_unavailable() {
        let base = std::env::temp_dir().join(format!("wf-m097-status-conflict-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let dir = folder.join(super::super::remove::MIGRATION_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("report-dev-a.json"), r#"{"version":1,"state":"verified","runs":[]}"#).unwrap();
        fs::write(dir.join("report-dev-a (1).json"), "{ not json").unwrap();
        let status = migration_status(&folder, &base.join("local-pg"), "dev-a");
        let _ = fs::remove_dir_all(&base);
        assert_eq!(status.state, "unavailable");
        assert_eq!(
            status.reason.as_deref(),
            Some("migration report report-dev-a (1).json is unreadable")
        );
        assert_eq!(status.step.as_deref(), Some("delete the conflict copy report-dev-a (1).json"));
    }

    #[test]
    fn another_devices_report_is_never_shown_as_this_devices_run() {
        let base = std::env::temp_dir().join(format!("wf-m097-status-other-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let dir = folder.join(super::super::remove::MIGRATION_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("report-dev-b.json"),
            r#"{"version":1,"state":"verified","runs":[{"deviceId":"dev-b","state":"verified","finishedAt":"2026-11-22T10:00:00.000Z"}]}"#,
        )
        .unwrap();
        let status = migration_status(&folder, &base.join("local-pg"), "dev-a");
        let _ = fs::remove_dir_all(&base);
        assert_eq!(status.state, "none", "no run from this device");
        assert!(!status.own_run_verified);
        assert_eq!(status.verified_at, None);
    }

    #[test]
    fn an_unreadable_legacy_report_makes_the_status_unavailable_with_a_restore_step() {
        let base = std::env::temp_dir().join(format!("wf-m097-status-legacy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("vault");
        let dir = folder.join(super::super::remove::MIGRATION_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("report.json"), "{ not json").unwrap();
        let status = migration_status(&folder, &base.join("local-pg"), "dev-a");
        let _ = fs::remove_dir_all(&base);
        assert_eq!(status.state, "unavailable");
        assert_eq!(
            status.reason.as_deref(),
            Some("report.json is unreadable; restore it from your backup or run the export again")
        );
        assert_eq!(status.step, None);
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
